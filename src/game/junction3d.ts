import {
  BoxGeometry, CylinderGeometry, DirectionalLight, Group, HemisphereLight, InstancedMesh,
  Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, OrthographicCamera, Scene,
  WebGLRenderer, type BufferGeometry, type Material,
} from 'three';
import { CENTER_X, CENTER_Y } from './constants';
import { buildTown } from './junctionTown';
import { signalAspect, type SignalAspect } from './signals';
import type { Axis, Direction, GameState, Vehicle } from './types';

export type CameraView = 'tilted' | 'overhead';

export interface JunctionRenderer {
  draw: (game: GameState, view: CameraView) => void;
  dispose: () => void;
}

const HEADING: Record<Direction, number> = {
  northbound: Math.PI,
  southbound: 0,
  eastbound: Math.PI / 2,
  westbound: -Math.PI / 2,
};

const signalColors: Record<SignalAspect, string> = {
  red: '#ff6364',
  amber: '#ffd163',
  green: '#d7f86c',
};
const aspects: SignalAspect[] = ['red', 'amber', 'green'];

export function createJunction(host: HTMLDivElement, onUnavailable: () => void): JunctionRenderer {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'low-power' });
  if (!context) throw new Error('WebGL 2 is unavailable');
  const renderer = new WebGLRenderer({ canvas, context });

  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 5, 4000);
  const sunlight = new DirectionalLight('#fff4de', 2.1);
  sunlight.position.set(-430, 900, 220);
  scene.add(new HemisphereLight('#d5e6ff', '#526ba0', 1.4), sunlight);

  const box = new BoxGeometry(1, 1, 1);
  const cylinder = new CylinderGeometry(.5, .5, 1, 8);
  const materials = new Map<string, MeshLambertMaterial>();
  const paint = (color: string) => {
    let material = materials.get(color);
    if (!material) {
      material = new MeshLambertMaterial({ color });
      materials.set(color, material);
    }
    return material;
  };
  const part = (
    group: Group, material: Material, x: number, y: number, z: number,
    width: number, height: number, depth: number,
  ) => {
    const mesh = new Mesh(box, material);
    mesh.scale.set(width, height, depth);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };

  // Batch the buildings, sidewalks and road markings by geometry and paint.
  const batch = (geometry: BufferGeometry) => {
    const transforms = new Map<string, Matrix4[]>();
    return {
      add: (color: string, x: number, y: number, z: number, width: number, height: number, depth: number) => {
        const transform = new Matrix4().makeScale(width, height, depth).setPosition(x, y, z);
        const items = transforms.get(color);
        if (items) items.push(transform);
        else transforms.set(color, [transform]);
      },
      commit: () => {
        for (const [color, items] of transforms) {
          const mesh = new InstancedMesh(geometry, paint(color), items.length);
          items.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
          mesh.instanceMatrix.needsUpdate = true;
          scene.add(mesh);
        }
        transforms.clear();
      },
    };
  };
  const townBoxes = batch(box);
  const townCylinders = batch(cylinder);
  buildTown(scene, townBoxes.add, townCylinders.add);
  townBoxes.commit();
  townCylinders.commit();

  const lampPaint = {
    red: new MeshBasicMaterial({ color: signalColors.red }),
    amber: new MeshBasicMaterial({ color: signalColors.amber }),
    green: new MeshBasicMaterial({ color: signalColors.green }),
  };
  const bulbOff = new MeshBasicMaterial({ color: '#485468' });
  const signalHousing = paint('#19283b');
  const signals = ([-1, 1] as const).flatMap((side) => {
    const placements: [Axis, number, number][] = [
      ['northSouth', -side * 126, side * 126],
      ['eastWest', side * 126, side * 126],
    ];
    return placements.map(([axis, x, z]) => {
      const post = new Group();
      post.position.set(x, 10, z);
      part(post, signalHousing, 0, 22, 0, 6, 44, 6);
      part(post, signalHousing, 0, 56, 0, 20, 36, 15);
      const lights = aspects.map((_, index) => part(post, bulbOff, 0, 66 - index * 10, 0, 10, 6, 17));
      const groundLamp = part(post, bulbOff, 0, 4, 0, 27, 4, 27);
      scene.add(post);
      return { axis, lights, groundLamp };
    });
  });

  const rubber = paint('#212c3c');
  const ink = paint('#101b34');
  const glass = paint('#355b91');
  const headlight = new MeshBasicMaterial({ color: '#fff1c4' });
  const brakeLight = new MeshBasicMaterial({ color: '#ff7865' });
  const trailPaint = new MeshBasicMaterial({ color: '#6fe1f5' });
  const waitingPaint = new MeshBasicMaterial({ color: '#ffd163' });
  const carRigs = new Map<number, ReturnType<typeof makeCar>>();

  function makeCar(vehicle: Vehicle) {
    const car = new Group();
    const { length, width, color } = vehicle;
    part(car, ink, 4, 1, 5, width + 12, 1, length + 12);
    const body = new Group();
    car.add(body);
    const bodyHeight = vehicle.kind === 'hopper' ? 22 : 17;
    const cabinLength = vehicle.kind === 'snail' ? length * .65 : length * .48;
    part(body, ink, 0, 8, 0, width + 4, 9, length + 4);
    part(body, paint(color.accent), 0, 12, 0, width, 7, length);
    part(body, paint(color.body), 0, 9 + bodyHeight / 2, 0, width - 4, bodyHeight, length - 5);
    part(body, ink, 0, bodyHeight + 11, -length * .08, width - 6, 7, cabinLength + 4);
    part(body, glass, 0, bodyHeight + 14, -length * .08, width - 11, 12, cabinLength);
    part(body, paint(color.roof), 0, bodyHeight + 21, -length * .08, width - 15, 5, cabinLength - 8);
    const brakeLights: Mesh[] = [];
    for (const side of [-1, 1]) {
      part(body, rubber, side * width * .44, 6, length * .28, 7, 12, 14);
      part(body, rubber, side * width * .44, 6, -length * .28, 7, 12, 14);
      part(body, headlight, side * width * .31, 14, length / 2 - 1, 8, 5, 3);
      brakeLights.push(part(body, paint(color.accent), side * width * .32, 14, -length / 2, 8, 5, 3));
    }
    const trail = new Group();
    part(trail, trailPaint, -7, 2, -length * .77, 6, 2, length * .4);
    part(trail, trailPaint, 7, 2, -length * .83, 6, 2, length * .4);
    car.add(trail);
    const waitingMark = part(car, waitingPaint, 0, bodyHeight + 35, 0, 11, 6, 11);
    car.rotation.y = HEADING[vehicle.direction];
    scene.add(car);
    return { car, body, brakeLights, trail, waitingMark };
  }

  let lastView: CameraView = 'tilted';
  const positionCamera = (view: CameraView) => {
    lastView = view;
    if (view === 'overhead') camera.position.set(0, 1300, .01);
    else camera.position.set(240, 1180, 675);
    camera.lookAt(0, 0, 0);
  };
  positionCamera(lastView);

  const resize = () => {
    const { clientWidth: width, clientHeight: height } = host;
    if (!width || !height) return;
    const aspect = width / height;
    const halfHeight = Math.max(335, 510 / aspect);
    const halfWidth = halfHeight * aspect;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    // Draw the street on a coarse grid while the DOM controls stay at native resolution.
    const pixelSize = width < 520 ? 2 : 3;
    renderer.setSize(Math.ceil(width / pixelSize), Math.ceil(height / pixelSize), false);
    renderer.render(scene, camera);
  };

  const loseContext = (event: Event) => {
    event.preventDefault();
    onUnavailable();
  };
  canvas.addEventListener('webglcontextlost', loseContext);
  const observer = new ResizeObserver(resize);
  host.append(canvas);
  observer.observe(host);

  return {
    draw(game, view) {
      if (view !== lastView) positionCamera(view);
      for (const signal of signals) {
        const state = signalAspect(game, signal.axis);
        signal.lights.forEach((lamp, index) => { lamp.material = aspects[index] === state ? lampPaint[state] : bulbOff; });
        signal.groundLamp.material = lampPaint[state];
      }

      const present = new Set<number>();
      for (const vehicle of game.vehicles) {
        present.add(vehicle.id);
        const rig = carRigs.get(vehicle.id) ?? makeCar(vehicle);
        carRigs.set(vehicle.id, rig);
        const vertical = vehicle.axis === 'northSouth';
        rig.car.position.set(
          vertical ? vehicle.laneOffset : vehicle.position - CENTER_X,
          0,
          vertical ? vehicle.position - CENTER_Y : vehicle.laneOffset,
        );
        rig.body.rotation.x = Math.max(-.06, Math.min(.06, vehicle.acceleration * .0008));
        const braking = vehicle.acceleration < -18 || vehicle.speed < 7;
        for (const light of rig.brakeLights) light.material = braking ? brakeLight : paint(vehicle.color.accent);
        rig.waitingMark.visible = vehicle.waitingTime > .6;
        rig.trail.visible = vehicle.speed > 25 && game.boostTimer > .5 && signalAspect(game, vehicle.axis) === 'green';
      }
      for (const [id, { car }] of carRigs) {
        if (!present.has(id)) {
          car.removeFromParent();
          carRigs.delete(id);
        }
      }
      renderer.render(scene, camera);
    },
    dispose() {
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', loseContext);
      // All per-car parts share the geometry and materials below.
      const geometries = new Set<BufferGeometry>([box, cylinder]);
      const usedMaterials = new Set<Material>([
        ...materials.values(), ...Object.values(lampPaint), bulbOff, headlight, brakeLight, trailPaint, waitingPaint,
      ]);
      scene.traverse((object) => {
        if (object instanceof InstancedMesh) object.dispose();
        if (object instanceof Mesh) {
          geometries.add(object.geometry);
          if (object.material instanceof MeshBasicMaterial) object.material.map?.dispose();
          usedMaterials.add(object.material as Material);
        }
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of usedMaterials) material.dispose();
      renderer.dispose();
      if (!context.isContextLost()) renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
