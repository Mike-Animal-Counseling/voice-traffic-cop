import {
  CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace,
  type Scene,
} from 'three';
import { INTERSECTION_SIZE, ROAD_WIDTH } from './constants';

type Place = (color: string, x: number, y: number, z: number, width: number, height: number, depth: number) => void;

export function buildTown(scene: Scene, box: Place, cylinder: Place) {
  const asphalt = '#30415a';
  const curb = '#8ea4b4';
  const markings = '#e3e9d7';
  const shoulder = ROAD_WIDTH / 2;
  const stopLine = INTERSECTION_SIZE / 2 + 14;
  const blockSize = 1500;

  box(asphalt, 0, -14, 0, 3200, 24, 3200);
  box('#344962', 0, -1, 0, ROAD_WIDTH, 3, ROAD_WIDTH);
  for (const sign of [-1, 1]) {
    const blockCenter = sign * (shoulder + blockSize / 2);
    for (const side of [-1, 1]) {
      box(curb, blockCenter, 4, side * (shoulder + blockSize / 2), blockSize, 12, blockSize);
      box('#678590', sign * 123, 10, side * 123, 22, 7, 22);
    }

    for (let offset = -83; offset <= 83; offset += 24) {
      box(markings, offset, 1, sign * (stopLine - 16), 13, 2, 26);
      box(markings, sign * (stopLine - 16), 1, offset, 26, 2, 13);
    }
    for (let distance = 190; distance < 1450; distance += 68) {
      box('#f6c863', 0, 1, sign * distance, 4, 2, 32);
      box('#f6c863', sign * distance, 1, 0, 32, 2, 4);
    }
    box(markings, -sign * 40, 2, sign * stopLine, 64, 2, 5);
    box(markings, sign * stopLine, 2, sign * 40, 5, 2, 64);
  }

  const shop = (
    x: number, z: number, width: number, depth: number, height: number,
    wall: string, roof: string, sign: string,
  ) => {
    box('#637c8b', x + 12, 11, z + 12, width + 18, 2, depth + 18);
    box(wall, x, 12 + height / 2, z, width, height, depth);
    box(roof, x, 16 + height, z, width + 12, 13, depth + 12);
    box('#172c43', x, 34, z + depth / 2 + 1, width - 22, 31, 6);
    box(wall, x, 34, z + depth / 2 + 4, 7, 32, 5);
    box('#b2cbcf', x - width * .24, 35, z + depth / 2 + 5, 16, 22, 2);
    box('#b2cbcf', x + width * .24, 35, z + depth / 2 + 5, 16, 22, 2);
    box('#d8d7be', x + width * .26, height + 28, z - depth * .24, 26, 15, 20);
    groundLabel(scene, sign, x - 12, height + 23, z + 5, width * .76, 28, '#f6f2df', roof);
  };

  shop(-261, -205, 150, 100, 86, '#8ab6d2', '#284bbb', 'JUNIPER TRAM');
  shop(262, -220, 166, 112, 106, '#cb8871', '#9b4250', 'SNAIL MAIL');
  shop(-274, 238, 158, 92, 63, '#edba7b', '#84502d', 'BERRY TEA');
  shop(309, 260, 152, 103, 82, '#81a897', '#365d57', 'PIP’S GARAGE');
  shop(-510, -270, 194, 128, 83, '#758caf', '#496684', 'DEPOT');
  shop(521, -269, 170, 128, 66, '#ac9fb9', '#66558a', 'MARKET');
  shop(-490, 304, 132, 94, 57, '#c38b7d', '#915e5c', 'BAKERY');
  shop(514, 313, 165, 116, 63, '#b4a280', '#726351', 'REPAIR');

  const trees = [
    [-393, -165, 29], [-175, -320, 30], [-572, -156, 34],
    [172, -329, 25], [408, -169, 33], [606, -169, 25],
    [-411, 180, 35], [-164, 284, 27], [-604, 177, 26],
    [175, 283, 31], [422, 190, 30], [616, 181, 34],
  ];
  for (const [x, z, size] of trees) {
    cylinder('#6d8791', x + 5, 11, z + 5, size * 2, 2, size * 1.6);
    cylinder('#775d4b', x, 27, z, 10, 32, 10);
    cylinder('#477367', x, 47, z, size * 1.7, 32, size * 1.7);
    cylinder('#719889', x - 3, 66, z - 3, size * 1.24, 15, size * 1.24);
  }

  for (const [x, z] of [[-170, -165], [173, -167], [-170, 167], [170, 168], [-410, -132], [415, 132]]) {
    box('#263a52', x, 28, z, 5, 40, 5);
    box('#f7d78f', x, 51, z, 16, 9, 12);
    box('#263a52', x, 57, z, 18, 4, 14);
  }

  for (const [label, x, z] of [
    ['N ↑', 67, -236], ['S ↓', -67, 238], ['W ←', -305, -66], ['E →', 305, 66],
  ] as const) {
    groundLabel(scene, label, x, 3, z, 67, 30, '#d5e3ea', asphalt);
  }
}

function groundLabel(
  scene: Scene, label: string, x: number, y: number, z: number,
  width: number, height: number, ink: string, background: string,
) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = background;
  context.fillRect(0, 0, 256, 96);
  context.fillStyle = ink;
  context.font = '900 36px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, 128, 48, 244);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const sign = new Mesh(new PlaneGeometry(width, height), new MeshBasicMaterial({ map: texture }));
  sign.rotation.x = -Math.PI / 2;
  sign.position.set(x, y, z);
  scene.add(sign);
}
