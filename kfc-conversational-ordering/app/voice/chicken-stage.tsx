"use client";

// The KFC virtual ambassador — a real low-poly 3D chicken loaded from
// /public/chicken.glb (Sketchfab GLB). Driven procedurally in three.js: the
// whole model bobs + sways when idle, bobs harder with speech (visemeLevel),
// tilts its head when thinking, and does a happy hop + wing flap on order
// placement. This GLB's rig is quirky (both arms are named "leftArm", no
// "rightArm", and arm pivots are offset), so pose values are best dialled in
// live: open /voice?tune for an on-screen panel that exports a JSON of the
// exact transforms to bake in here.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type Props = {
  speaking: boolean;
  thinking: boolean;
  mood: "idle" | "happy";
  visemeLevel: number;
};

// Live-tuning state: offsets from the model's auto-framed rest pose.
type Tune = {
  yaw: number; pitch: number; roll: number; // whole-model rotation (deg)
  posY: number; scaleMul: number; // vertical offset + scale multiplier
  camDistMul: number; camHeightMul: number; fov: number; // camera
  a0rx: number; a0ry: number; a0rz: number; a0px: number; a0py: number; a0pz: number; // arm 0 (leftArm_4)
  a1rx: number; a1ry: number; a1rz: number; a1px: number; a1py: number; a1pz: number; // arm 1 (leftArm_13)
  armSplay: number; // symmetric arm tilt (deg): +left / -right, mirrors both wings, feeds ARM_SPLAY
  hrx: number; hrz: number; // head rotation offset (deg)
};

const DEFAULT_TUNE: Tune = {
  yaw: 180, pitch: 5, roll: 0,
  posY: -0.12, scaleMul: 0.86,
  camDistMul: 2.15, camHeightMul: 0.58, fov: 30,
  a0rx: 0, a0ry: 0, a0rz: 0, a0px: 0, a0py: 0, a0pz: 0,
  a1rx: 0, a1ry: 0, a1rz: 0, a1px: 0, a1py: 0, a1pz: 0,
  armSplay: 7,
  hrx: 0, hrz: 0,
};

type Field = { k: keyof Tune; label: string; min: number; max: number; step: number };
const FIELDS: { group: string; items: Field[] }[] = [
  {
    group: "Model",
    items: [
      { k: "yaw", label: "yaw°", min: -180, max: 180, step: 1 },
      { k: "pitch", label: "pitch°", min: -90, max: 90, step: 1 },
      { k: "roll", label: "roll°", min: -90, max: 90, step: 1 },
      { k: "posY", label: "posY", min: -1, max: 1, step: 0.01 },
      { k: "scaleMul", label: "scale×", min: 0.3, max: 2, step: 0.01 },
    ],
  },
  {
    group: "Camera",
    items: [
      { k: "camDistMul", label: "dist", min: 1, max: 5, step: 0.05 },
      { k: "camHeightMul", label: "height", min: -0.5, max: 2, step: 0.02 },
      { k: "fov", label: "fov", min: 15, max: 70, step: 1 },
    ],
  },
  {
    group: "Arms · both",
    items: [
      { k: "armSplay", label: "splay°", min: -90, max: 90, step: 1 },
    ],
  },
  {
    group: "Arm 0 · leftArm_4",
    items: [
      { k: "a0rx", label: "rotX°", min: -180, max: 180, step: 1 },
      { k: "a0ry", label: "rotY°", min: -180, max: 180, step: 1 },
      { k: "a0rz", label: "rotZ°", min: -180, max: 180, step: 1 },
      { k: "a0px", label: "posX", min: -0.6, max: 0.6, step: 0.01 },
      { k: "a0py", label: "posY", min: -0.6, max: 0.6, step: 0.01 },
      { k: "a0pz", label: "posZ", min: -0.6, max: 0.6, step: 0.01 },
    ],
  },
  {
    group: "Arm 1 · leftArm_13",
    items: [
      { k: "a1rx", label: "rotX°", min: -180, max: 180, step: 1 },
      { k: "a1ry", label: "rotY°", min: -180, max: 180, step: 1 },
      { k: "a1rz", label: "rotZ°", min: -180, max: 180, step: 1 },
      { k: "a1px", label: "posX", min: -0.6, max: 0.6, step: 0.01 },
      { k: "a1py", label: "posY", min: -0.6, max: 0.6, step: 0.01 },
      { k: "a1pz", label: "posZ", min: -0.6, max: 0.6, step: 0.01 },
    ],
  },
  {
    group: "Head",
    items: [
      { k: "hrx", label: "rotX°", min: -90, max: 90, step: 1 },
      { k: "hrz", label: "rotZ°", min: -90, max: 90, step: 1 },
    ],
  },
];

// Find the first descendant whose name contains any of the given tokens.
function findNode(root: THREE.Object3D, ...tokens: string[]): THREE.Object3D | null {
  let hit: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (hit) return;
    const n = o.name.toLowerCase();
    if (tokens.some((t) => n.includes(t))) hit = o;
  });
  return hit;
}

// All descendants whose name contains any token, in traversal order. Needed
// because this GLB names BOTH arms "leftArm" (leftArm_4, leftArm_13) with no
// "rightArm", so left/right lookup by name only ever finds one of the two.
function findNodes(root: THREE.Object3D, ...tokens: string[]): THREE.Object3D[] {
  const hits: THREE.Object3D[] = [];
  root.traverse((o) => {
    const n = o.name.toLowerCase();
    if (tokens.some((t) => n.includes(t))) hits.push(o);
  });
  return hits;
}

const D2R = Math.PI / 180;

export default function ChickenStage(props: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const state = useRef<Props>(props);
  state.current = props;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tuning, setTuning] = useState(false);
  const [tune, setTune] = useState<Tune>(DEFAULT_TUNE);
  const [exportText, setExportText] = useState("");
  // Live tuning values read by the render loop; null = normal animation.
  const tuneRef = useRef<Tune | null>(null);

  // Enable the tuning panel + freeze animation when ?tune is in the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).has("tune")) {
      tuneRef.current = DEFAULT_TUNE;
      setTuning(true);
    }
  }, []);

  function update(key: keyof Tune, value: number) {
    setTune((prev) => {
      const next = { ...prev, [key]: value };
      tuneRef.current = next;
      return next;
    });
  }

  function doExport() {
    const t = tune;
    const json = {
      note: "Paste this back to Claude to bake in the ambassador pose.",
      yawDeg: t.yaw, pitchDeg: t.pitch, rollDeg: t.roll,
      posY: t.posY, scaleMul: t.scaleMul,
      camDistMul: t.camDistMul, camHeightMul: t.camHeightMul, fov: t.fov,
      armSplayDeg: t.armSplay,
      arm0_leftArm_4: { rotDeg: [t.a0rx, t.a0ry, t.a0rz], pos: [t.a0px, t.a0py, t.a0pz] },
      arm1_leftArm_13: { rotDeg: [t.a1rx, t.a1ry, t.a1rz], pos: [t.a1px, t.a1py, t.a1pz] },
      head: { rxDeg: t.hrx, rzDeg: t.hrz },
    };
    const text = JSON.stringify(json, null, 2);
    setExportText(text);
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Non-tune facing/pose (kept for the shipped page). Overridden while tuning.
    const params = new URLSearchParams(window.location.search);
    const yawParam = params.get("yaw");
    const FACE_YAW = yawParam !== null ? Number(yawParam) * D2R : Math.PI;
    // Baked ambassador pose — dialled in live via /voice?tune, then exported.
    const POSE = {
      pitch: 5 * D2R, roll: 0, posY: -0.12, scaleMul: 0.86,
      camDistMul: 2.15, camHeightMul: 0.58,
    };

    const width = () => mount.clientWidth || window.innerWidth;
    const height = () => mount.clientHeight || Math.round(window.innerHeight * 0.6);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(width(), height());
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, width() / height(), 0.01, 100);

    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(2, 3, 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffe6d0, 0.6);
    fill.position.set(-2, 1, 2);
    scene.add(fill);

    const root = new THREE.Group();
    scene.add(root);

    let model: THREE.Object3D | null = null;
    let headNode: THREE.Object3D | null = null;
    let leftWing: THREE.Object3D | null = null;
    let rightWing: THREE.Object3D | null = null;
    const headBaseRot = new THREE.Euler();
    const leftWingBaseRot = new THREE.Euler();
    const rightWingBaseRot = new THREE.Euler();
    const leftWingBasePos = new THREE.Vector3();
    const rightWingBasePos = new THREE.Vector3();
    const modelBasePos = new THREE.Vector3();
    let autoScale = 1;
    let targetHeight = 1.6;

    let raf = 0;
    let disposed = false;

    const loader = new GLTFLoader();
    loader.load(
      "/chicken.glb",
      (gltf) => {
        if (disposed) return;
        model = gltf.scene;

        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        targetHeight = 1.6;
        autoScale = size.y > 0 ? targetHeight / size.y : 1;
        model.scale.setScalar(autoScale * POSE.scaleMul);
        model.position.set(-center.x * autoScale, -box.min.y * autoScale, -center.z * autoScale);
        modelBasePos.copy(model.position);
        root.add(model);

        camera.position.set(0, targetHeight * POSE.camHeightMul, targetHeight * POSE.camDistMul);
        camera.lookAt(0, targetHeight * 0.5, 0);

        headNode = findNode(model, "head");
        const arms = findNodes(model, "arm", "wing");
        leftWing = arms[0] ?? null;
        rightWing = arms[1] ?? null;
        if (headNode) headBaseRot.copy(headNode.rotation);
        if (leftWing) {
          leftWingBaseRot.copy(leftWing.rotation);
          leftWingBasePos.copy(leftWing.position);
        }
        if (rightWing) {
          rightWingBaseRot.copy(rightWing.rotation);
          rightWingBasePos.copy(rightWing.position);
        }

        setReady(true);
      },
      undefined,
      () => {
        if (!disposed) setFailed(true);
      },
    );

    // ---- animation ----
    let mouth = 0;
    let hop = 0;
    let lean = 0; // eased 0→1 while the agent is thinking
    let lastRender = performance.now();
    let elapsed = 0;
    // Cap at 30fps — an idle bob doesn't need 120, and uncapped rAF at
    // devicePixelRatio 2 was the source of the lag.
    const MIN_FRAME_MS = 1000 / 30;

    function animate() {
      raf = requestAnimationFrame(animate);
      const now = performance.now();
      if (now - lastRender < MIN_FRAME_MS) return;
      const delta = Math.min(0.05, (now - lastRender) / 1000);
      lastRender = now;
      elapsed += delta;

      // Tuning mode: apply the live panel values verbatim, no procedural motion,
      // so what you see is exactly what Export writes.
      const t = tuneRef.current;
      if (t) {
        root.rotation.set(t.pitch * D2R, t.yaw * D2R, t.roll * D2R);
        root.position.set(0, t.posY, 0);
        if (model) {
          model.scale.setScalar(autoScale * t.scaleMul);
          model.position.copy(modelBasePos);
        }
        camera.position.set(0, targetHeight * t.camHeightMul, targetHeight * t.camDistMul);
        camera.lookAt(0, targetHeight * 0.5, 0);
        camera.fov = t.fov;
        camera.updateProjectionMatrix();
        if (leftWing) {
          leftWing.rotation.set(
            leftWingBaseRot.x + t.a0rx * D2R,
            leftWingBaseRot.y + t.a0ry * D2R,
            leftWingBaseRot.z + (t.a0rz + t.armSplay) * D2R,
          );
          leftWing.position.set(
            leftWingBasePos.x + t.a0px,
            leftWingBasePos.y + t.a0py,
            leftWingBasePos.z + t.a0pz,
          );
        }
        if (rightWing) {
          rightWing.rotation.set(
            rightWingBaseRot.x + t.a1rx * D2R,
            rightWingBaseRot.y + t.a1ry * D2R,
            rightWingBaseRot.z + (t.a1rz - t.armSplay) * D2R,
          );
          rightWing.position.set(
            rightWingBasePos.x + t.a1px,
            rightWingBasePos.y + t.a1py,
            rightWingBasePos.z + t.a1pz,
          );
        }
        if (headNode) {
          headNode.rotation.set(headBaseRot.x + t.hrx * D2R, headBaseRot.y, headBaseRot.z + t.hrz * D2R);
        }
        renderer.render(scene, camera);
        return;
      }

      const s = state.current;

      // ALL expression lives on the ROOT transform (position + rotation). This
      // GLB's rig is mis-authored — both arms are named "leftArm", pivots are
      // offset — so rotating its bones collapses/twists the mesh (the whole
      // reason the earlier bone-driven idle motion looked broken). Root motion
      // can never deform the model, so the chicken always reads as a chicken.

      // Idle: gentle vertical bob + slow yaw + slow roll sway (yaw offset keeps
      // it facing us).
      let posY = POSE.posY + Math.sin(elapsed * 2.0) * 0.02;
      let rotX = POSE.pitch;
      let rotZ = POSE.roll + Math.sin(elapsed * 0.8) * 0.025;
      let rotY = FACE_YAW + Math.sin(elapsed * 0.45) * 0.05;

      // Speaking: a talking head-nod (root pitch) + livelier bob, both scaled by
      // the live viseme level so the body moves in time with the voice.
      const talk = s.speaking ? 0.25 + s.visemeLevel * 0.75 : 0;
      mouth = THREE.MathUtils.lerp(mouth, talk, 0.35);
      posY += Math.abs(Math.sin(elapsed * 9)) * 0.035 * mouth;
      rotX += Math.sin(elapsed * 8) * 0.05 * mouth;

      // Thinking: ease into a curious lean (tilt + look-up), hold while busy.
      lean = THREE.MathUtils.lerp(lean, s.thinking ? 1 : 0, 0.08);
      rotZ += 0.16 * lean;
      rotX += -0.1 * lean;
      rotY += 0.12 * lean;

      // Happy: a bouncy hop + a quick shimmy (root roll wiggle) on order placed.
      if (s.mood === "happy") hop = Math.min(1, hop + delta * 4);
      else hop = Math.max(0, hop - delta * 2.5);
      posY += Math.abs(Math.sin(elapsed * 11)) * 0.12 * hop;
      rotZ += Math.sin(elapsed * 16) * 0.12 * hop;

      root.position.set(0, posY, 0);
      root.rotation.set(rotX, rotY, rotZ);
      renderer.render(scene, camera);
    }
    animate();

    const onResize = () => {
      const w = width();
      const h = height();
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(mount);
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mm = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
        else mm?.dispose();
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div className="vrm-stage-wrap">
      <div ref={mountRef} className="vrm-stage" />
      {failed ? (
        <div className="vrm-status vrm-status--error">Could not load the chicken model.</div>
      ) : !ready ? (
        <div className="vrm-status vrm-status--loading">Calling the Chicken Ambassador...</div>
      ) : null}

      {tuning ? (
        <div className="tune-panel">
          <div className="tune-panel__title">🐔 Pose tuner</div>
          {FIELDS.map((section) => (
            <div key={section.group} className="tune-panel__group">
              <div className="tune-panel__group-title">{section.group}</div>
              {section.items.map((f) => (
                <label key={f.k} className="tune-row">
                  <span className="tune-row__label">{f.label}</span>
                  <input
                    type="range"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={tune[f.k]}
                    onChange={(e) => update(f.k, Number(e.target.value))}
                  />
                  <input
                    type="number"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={tune[f.k]}
                    onChange={(e) => update(f.k, Number(e.target.value))}
                    className="tune-row__num"
                  />
                </label>
              ))}
            </div>
          ))}
          <div className="tune-panel__actions">
            <button type="button" onClick={doExport}>Copy JSON</button>
            <button type="button" onClick={() => { setTune(DEFAULT_TUNE); tuneRef.current = DEFAULT_TUNE; }}>
              Reset
            </button>
          </div>
          {exportText ? <textarea className="tune-panel__out" readOnly value={exportText} /> : null}
          <div className="tune-panel__hint">Copied to clipboard, paste it to Claude.</div>
        </div>
      ) : null}
    </div>
  );
}
