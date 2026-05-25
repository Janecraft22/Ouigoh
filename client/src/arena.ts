import * as THREE from "three";

/** Build the arena environment: ground, fog, sky, lighting, boundary, scattered props. */
export function buildArena(scene: THREE.Scene, arenaRadius: number) {
  // Sky
  const sky = makeSky();
  scene.add(sky);

  // Fog for atmosphere
  scene.fog = new THREE.FogExp2(0x161a1f, 0.018);

  // Ground
  const groundGeom = new THREE.CircleGeometry(arenaRadius * 1.2, 96);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x4d4538,
    roughness: 0.95,
    metalness: 0.05,
  });
  const ground = new THREE.Mesh(groundGeom, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Combat ring marker — inner contrasting circle for tactical reference
  const ringGeom = new THREE.RingGeometry(arenaRadius - 0.6, arenaRadius - 0.4, 96);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xb55a3a,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.6,
  });
  const ring = new THREE.Mesh(ringGeom, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);

  // Subtle ground patches for visual variety
  const patchMat = new THREE.MeshStandardMaterial({
    color: 0x2a241c,
    roughness: 1,
    metalness: 0,
  });
  for (let i = 0; i < 24; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * (arenaRadius - 2);
    const s = 0.6 + Math.random() * 1.8;
    const patch = new THREE.Mesh(new THREE.CircleGeometry(s, 12), patchMat);
    patch.position.set(Math.cos(a) * r, 0.011, Math.sin(a) * r);
    patch.rotation.x = -Math.PI / 2;
    patch.rotation.z = Math.random() * Math.PI;
    patch.receiveShadow = true;
    scene.add(patch);
  }

  // Boundary pillars
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x3a3429, roughness: 0.8 });
  const torchMat = new THREE.MeshBasicMaterial({ color: 0xffae55 });
  const NUM_PILLARS = 16;
  const pillarGroup = new THREE.Group();
  for (let i = 0; i < NUM_PILLARS; i++) {
    const ang = (i / NUM_PILLARS) * Math.PI * 2;
    const x = Math.cos(ang) * (arenaRadius + 0.4);
    const z = Math.sin(ang) * (arenaRadius + 0.4);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 3.6, 8), pillarMat);
    pillar.position.set(x, 1.8, z);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    pillarGroup.add(pillar);

    const torch = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), torchMat);
    torch.position.set(x, 3.7, z);
    pillarGroup.add(torch);
    const torchLight = new THREE.PointLight(0xffa050, 0.85, 9, 2.0);
    torchLight.position.set(x, 3.7, z);
    pillarGroup.add(torchLight);
  }
  scene.add(pillarGroup);

  // A few rocks scattered (cosmetic, no collision in MVP)
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6a6e74, roughness: 1 });
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = arenaRadius * 0.6 + Math.random() * (arenaRadius * 0.25);
    const s = 0.4 + Math.random() * 0.7;
    const geom = new THREE.DodecahedronGeometry(s, 0);
    const rock = new THREE.Mesh(geom, rockMat);
    rock.position.set(Math.cos(a) * r, s * 0.4, Math.sin(a) * r);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  // Lighting
  const hemi = new THREE.HemisphereLight(0x9fb2c2, 0x352c25, 0.65);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff0d0, 1.05);
  sun.position.set(10, 18, 6);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 80;
  sun.shadow.camera.left = -arenaRadius - 4;
  sun.shadow.camera.right = arenaRadius + 4;
  sun.shadow.camera.top = arenaRadius + 4;
  sun.shadow.camera.bottom = -arenaRadius - 4;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);

  return { ground, sun };
}

function makeSky(): THREE.Mesh {
  // Procedural gradient sky shader (vertex-only, large inverted sphere)
  const geom = new THREE.SphereGeometry(500, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x1f2a36) },
      mid: { value: new THREE.Color(0x312c2a) },
      bot: { value: new THREE.Color(0x1a1715) },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main(){
        vWorld = (modelMatrix * vec4(position,1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld,1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 top, mid, bot;
      varying vec3 vWorld;
      void main(){
        float h = normalize(vWorld).y;
        vec3 col;
        if (h > 0.0) {
          col = mix(mid, top, smoothstep(0.0, 0.7, h));
        } else {
          col = mix(mid, bot, smoothstep(0.0, -0.4, h));
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  return new THREE.Mesh(geom, mat);
}
