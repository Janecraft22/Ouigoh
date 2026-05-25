import * as THREE from "three";

/** Procedural knife mesh — blade + crossguard + grip. Cheap to render. */
export function makeKnife(): THREE.Group {
  const group = new THREE.Group();
  group.name = "knife";

  // Blade — elongated triangular prism approximated with a flat box
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.045, 0.34, 0.012),
    new THREE.MeshStandardMaterial({
      color: 0xc8d0d8,
      metalness: 0.85,
      roughness: 0.25,
    }),
  );
  blade.position.set(0, 0.22, 0);
  blade.castShadow = true;
  group.add(blade);

  // Tip
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.022, 0.06, 6),
    new THREE.MeshStandardMaterial({ color: 0xc8d0d8, metalness: 0.85, roughness: 0.25 }),
  );
  tip.position.set(0, 0.42, 0);
  tip.castShadow = true;
  group.add(tip);

  // Crossguard
  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.018, 0.025),
    new THREE.MeshStandardMaterial({ color: 0x5a4632, metalness: 0.3, roughness: 0.55 }),
  );
  guard.position.set(0, 0.04, 0);
  guard.castShadow = true;
  group.add(guard);

  // Grip
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, 0.10, 8),
    new THREE.MeshStandardMaterial({ color: 0x2c1d10, roughness: 0.85 }),
  );
  grip.position.set(0, -0.02, 0);
  grip.castShadow = true;
  group.add(grip);

  // Reasonable orientation for being held — point blade away from forearm.
  // The bone's forward axis isn't standardised, so we apply a global tilt.
  group.scale.setScalar(1);
  group.rotation.set(Math.PI / 2, 0, 0);
  group.position.set(0.0, 0.02, -0.08);

  return group;
}
