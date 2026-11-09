import {
  CanvasTexture, Mesh, MeshBasicMaterial, NearestFilter, PlaneGeometry, SRGBColorSpace,
  type Scene,
} from 'three';
import { INTERSECTION_SIZE, ROAD_WIDTH } from './constants';

type Place = (color: string, x: number, y: number, z: number, width: number, height: number, depth: number) => void;

// Five rows of three pixels for each character used on the street signs.
const streetGlyphs: Record<string, number[]> = {
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], D: [6, 5, 5, 5, 6],
  E: [7, 4, 6, 4, 7], G: [7, 4, 5, 5, 7], I: [7, 2, 2, 2, 7],
  K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7], M: [5, 7, 7, 5, 5],
  N: [5, 7, 7, 7, 5], O: [7, 5, 5, 5, 7], P: [7, 5, 7, 4, 4],
  R: [6, 5, 6, 5, 5], S: [7, 4, 7, 1, 7], T: [7, 2, 2, 2, 2],
  W: [5, 5, 7, 7, 5], Y: [5, 5, 2, 2, 2], ' ': [0, 0, 0, 0, 0],
  '↑': [2, 7, 2, 2, 2], '↓': [2, 2, 2, 7, 2],
};

export function buildTown(scene: Scene, box: Place, cylinder: Place) {
  const asphalt = '#23365e';
  const curb = '#85a1d0';
  const markings = '#f5e6b9';
  const shoulder = ROAD_WIDTH / 2;
  const stopLine = INTERSECTION_SIZE / 2 + 14;
  const blockSize = 1500;

  box(asphalt, 0, -14, 0, 3200, 24, 3200);
  box('#293e6a', 0, -1, 0, ROAD_WIDTH, 3, ROAD_WIDTH);
  for (const sign of [-1, 1]) {
    const blockCenter = sign * (shoulder + blockSize / 2);
    for (const side of [-1, 1]) {
      const blockZ = side * (shoulder + blockSize / 2);
      box('#1c2c50', blockCenter, 3, blockZ, blockSize, 10, blockSize);
      box(curb, blockCenter + sign * 3, 8, blockZ + side * 3, blockSize - 6, 4, blockSize - 6);
      box('#5a76ad', sign * 123, 10, side * 123, 22, 7, 22);
      for (let column = 0; column < 6; column += 1) {
        for (let row = 0; row < 3; row += 1) {
          box('#637daf', sign * (161 + column * 11), 10.5, side * (128 + row * 11), 4, 1, 4);
        }
      }
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
    box('#45609b', x + 12, 11, z + 12, width + 18, 2, depth + 18);
    box(wall, x, 12 + height / 2, z, width, height, depth);
    box('#1d294c', x, 13 + height, z, width + 16, 10, depth + 16);
    box(roof, x, 18 + height, z, width + 12, 9, depth + 12);
    box('#172c43', x, 34, z + depth / 2 + 1, width - 22, 31, 6);
    box(wall, x, 34, z + depth / 2 + 4, 7, 32, 5);
    box('#b2cbcf', x - width * .24, 35, z + depth / 2 + 5, 16, 22, 2);
    box('#b2cbcf', x + width * .24, 35, z + depth / 2 + 5, 16, 22, 2);
    box('#d8d7be', x + width * .26, height + 28, z - depth * .24, 26, 15, 20);
    groundLabel(scene, sign, x - 12, height + 23, z + 5, width * .76, 28, '#f6f2df', roof);
  };

  shop(-261, -205, 150, 100, 86, '#87ade0', '#234dcc', 'TRAM');
  shop(262, -220, 166, 112, 106, '#bb7f75', '#a14452', 'MAIL');
  shop(-274, 238, 158, 92, 63, '#edba7b', '#9b542e', 'TEA');
  shop(309, 260, 152, 103, 82, '#7eadd4', '#365f9b', 'GARAGE');
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
    cylinder('#4d7754', x, 47, z, size * 1.7, 32, size * 1.7);
    cylinder('#99b65c', x - 3, 66, z - 3, size * 1.24, 15, size * 1.24);
  }

  for (const [x, z] of [[-170, -165], [173, -167], [-170, 167], [170, 168], [-410, -132], [415, 132]]) {
    box('#263a52', x, 28, z, 5, 40, 5);
    box('#f7d78f', x, 51, z, 16, 9, 12);
    box('#263a52', x, 57, z, 18, 4, 14);
  }

  for (const [label, x, z] of [
    ['N ↑', 67, -236], ['S ↓', -67, 238], ['W', -305, -66], ['E', 305, 66],
  ] as const) {
    groundLabel(scene, label, x, 3, z, 67, 30, '#d5e3ea', asphalt);
  }
}

function groundLabel(
  scene: Scene, label: string, x: number, y: number, z: number,
  width: number, height: number, ink: string, background: string,
) {
  const canvas = document.createElement('canvas');
  canvas.width = label.length * 4 + 1;
  canvas.height = 7;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = ink;
  for (const [index, letter] of [...label].entries()) {
    (streetGlyphs[letter] ?? streetGlyphs[' ']).forEach((row, y) => {
      for (let x = 0; x < 3; x += 1) {
        if (row & (4 >> x)) context.fillRect(index * 4 + x + 1, y + 1, 1, 1);
      }
    });
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  const signWidth = Math.min(width, height * canvas.width / canvas.height);
  const sign = new Mesh(new PlaneGeometry(signWidth, height), new MeshBasicMaterial({ map: texture }));
  sign.rotation.x = -Math.PI / 2;
  sign.position.set(x, y, z);
  scene.add(sign);
}
