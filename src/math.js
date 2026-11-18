// All transforms use column vectors: p_target = R * p_source + t.
export const FORMATS = [
  { id: 'translation', label: 'Translation', layout: '[x y z]', count: 3, group: 'vector' },
  { id: 'quat-xyzw', label: 'Quaternion', layout: '[qx qy qz qw]', count: 4, group: 'quaternion' },
  { id: 'quat-wxyz', label: 'Quaternion', layout: '[qw qx qy qz]', count: 4, group: 'quaternion' },
  { id: 'rpy', label: 'RPY (ROS)', layout: '[roll pitch yaw] · deg', count: 3, group: 'euler' },
  { id: 'ypr', label: 'YPR', layout: '[yaw pitch roll] · deg', count: 3, group: 'euler' },
  { id: 'mat3-row', label: '3×3 Matrix', layout: 'Row-major · 行主序', count: 9, group: 'matrix' },
  { id: 'mat3-col', label: '3×3 Matrix', layout: 'Column-major · 列主序', count: 9, group: 'matrix' },
  { id: 'mat4-row', label: '4×4 Matrix', layout: 'Row-major · 行主序', count: 16, group: 'matrix' },
  { id: 'mat4-col', label: '4×4 Matrix', layout: 'Column-major · 列主序', count: 16, group: 'matrix' },
  { id: 'tum', label: 'TUM', layout: '[tx ty tz qx qy qz qw]', count: 7, group: 'pose' },
];

export const ROTATION_TOLERANCE = 1e-4;
export const HOMOGENEOUS_TOLERANCE = 1e-8;
export const identity = () => ({ translation: [0, 0, 0], rotation: [0, 0, 0, 1] });

export class InputError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'InputError';
    Object.assign(this, details);
  }
}

export function getFormat(id) {
  const format = FORMATS.find((item) => item.id === id);
  if (!format) throw new InputError('未知的输入格式。');
  return format;
}

export function extractNumbers(text) {
  const normalized = String(text)
    .replace(/&(?:nbsp|ensp|emsp|thinsp|tab|newline);|&#(x[\da-f]+|\d+);/gi, (entity, code) => {
      if (code === undefined) return ' ';
      const point = Number(/^x/i.test(code) ? `0${code}` : code);
      return point <= 0x10ffff && /\s/.test(String.fromCodePoint(point)) ? ' ' : entity;
    })
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/[−－]/g, '-').replace(/＋/g, '+').replace(/．/g, '.');
  const tokens = normalized.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) || [];
  return tokens.map(Number);
}

export function normalizeQuaternion(quaternion) {
  if (quaternion.length !== 4 || quaternion.some((value) => !Number.isFinite(value))) {
    throw new InputError('四元数必须包含四个有限数值。');
  }
  const scale = Math.max(...quaternion.map(Math.abs));
  if (scale === 0) throw new InputError('四元数不能全为零，请输入有效旋转。');
  const scaled = quaternion.map((value) => value / scale);
  const length = Math.hypot(...scaled);
  const result = scaled.map((value) => value / length);
  // q and -q describe the same rotation. Choose one sign for stable output.
  const first = result[3] !== 0 ? result[3] : result.find((value) => value !== 0);
  return result.map((value) => (first < 0 ? -value : value) || 0);
}

export function multiplyQuaternion(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quaternionToMatrix(quaternion) {
  const [x, y, z, w] = normalizeQuaternion(quaternion);
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

export function matrixToQuaternion(m) {
  const trace = m[0][0] + m[1][1] + m[2][2];
  let q;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, s / 4];
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    q = [s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s];
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    q = [(m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s];
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    q = [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4, (m[1][0] - m[0][1]) / s];
  }
  return normalizeQuaternion(q);
}

export function multiplyVector(matrix, vector) {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

export function rpyToQuaternion(angles) {
  const [r, p, y] = angles.map((value) => ((value % 360) * Math.PI) / 360);
  const [cr, cp, cy] = [r, p, y].map(Math.cos);
  const [sr, sp, sy] = [r, p, y].map(Math.sin);
  return normalizeQuaternion([
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
    cr * cp * cy + sr * sp * sy,
  ]);
}

export function quaternionToRPY(quaternion) {
  const m = quaternionToMatrix(quaternion);
  const horizontal = Math.hypot(m[0][0], m[1][0]);
  const gimbalLock = horizontal < 1e-10;
  const roll = gimbalLock ? 0 : Math.atan2(m[2][1], m[2][2]);
  const pitch = Math.atan2(-m[2][0], horizontal);
  const yaw = gimbalLock ? Math.atan2(-m[0][1], m[1][1]) : Math.atan2(m[1][0], m[0][0]);
  return { angles: [roll, pitch, yaw].map((value) => value * 180 / Math.PI), gimbalLock };
}

function rotationGramError(matrix) {
  return matrix.map((_, rowIndex) => matrix.map((_, columnIndex) =>
    matrix.reduce((dot, row) => dot + row[rowIndex] * row[columnIndex], 0) - Number(rowIndex === columnIndex)));
}

function validateRotation(matrix) {
  const orthogonality = Math.max(...rotationGramError(matrix).flat().map(Math.abs));
  const [first, second, third] = matrix;
  const determinant = first[0] * (second[1] * third[2] - second[2] * third[1])
    - first[1] * (second[0] * third[2] - second[2] * third[0])
    + first[2] * (second[0] * third[1] - second[1] * third[0]);
  const determinantError = Math.abs(determinant - 1);
  const error = Math.max(orthogonality, determinantError);
  if (!Number.isFinite(error) || error > ROTATION_TOLERANCE) {
    throw new InputError(`旋转矩阵无效：RᵀR 的最大误差和 |det(R) − 1| 均须 ≤ ${ROTATION_TOLERANCE.toExponential()}，请检查缩放、剪切或镜像。`);
  }
  return error > 1e-12;
}

function projectRotation(matrix) {
  let rotation = matrix;
  for (let iteration = 0; iteration < 3; iteration++) {
    const gramError = rotationGramError(rotation);
    rotation = rotation.map((row) => {
      const correction = multiplyVector(gramError, row);
      return row.map((value, column) => value - correction[column] / 2);
    });
  }
  return rotation;
}

export function parseTransform(text, formatId) {
  const format = getFormat(formatId);
  const values = extractNumbers(text);
  if (values.length !== format.count) {
    throw new InputError(`数字数量不符：${format.label} 需要 ${format.count} 个，实际提取 ${values.length} 个。`, {
      actual: values.length, required: format.count,
    });
  }
  if (values.some((value) => !Number.isFinite(value))) throw new InputError('输入含溢出或非有限数值，请检查科学计数法的指数。');
  const transform = identity();
  const notices = [];
  let quaternion;
  if (formatId === 'translation') {
    transform.translation = values;
  } else if (formatId === 'quat-xyzw') {
    quaternion = values;
  } else if (formatId === 'quat-wxyz') {
    quaternion = [...values.slice(1), values[0]];
  } else if (formatId === 'tum') {
    transform.translation = values.slice(0, 3);
    quaternion = values.slice(3);
  } else if (formatId === 'rpy' || formatId === 'ypr') {
    transform.rotation = rpyToQuaternion(formatId === 'rpy' ? values : [...values].reverse());
  } else {
    const size = formatId.startsWith('mat3') ? 3 : 4;
    const columnMajor = formatId.endsWith('col');
    const matrix = Array.from({ length: size }, (_, row) =>
      Array.from({ length: size }, (_, col) => values[columnMajor ? col * size + row : row * size + col]));
    if (size === 4) {
      const expected = [0, 0, 0, 1];
      if (matrix[3].some((value, index) => Math.abs(value - expected[index]) > HOMOGENEOUS_TOLERANCE)) {
        throw new InputError('4×4 齐次矩阵的末行必须为 [0 0 0 1]（容差 1e-8）。');
      }
      if (matrix[3].some((value, index) => value !== expected[index])) notices.push('齐次矩阵末行已规范化为 [0 0 0 1]。');
      transform.translation = matrix.slice(0, 3).map((row) => row[3]);
    }
    const rotation = matrix.slice(0, 3).map((row) => row.slice(0, 3));
    const needsCorrection = validateRotation(rotation);
    if (needsCorrection) notices.push('旋转矩阵已校正为最接近的有效旋转。');
    transform.rotation = matrixToQuaternion(needsCorrection ? projectRotation(rotation) : rotation);
  }
  if (quaternion) {
    transform.rotation = normalizeQuaternion(quaternion);
    if (Math.abs(Math.hypot(...quaternion) - 1) > 1e-12) notices.push('输入四元数已归一化为单位四元数。');
  }
  return { transform, values, notices };
}

export function compose(left, right) {
  const rotation = normalizeQuaternion(multiplyQuaternion(left.rotation, right.rotation));
  const translation = multiplyVector(quaternionToMatrix(left.rotation), right.translation)
    .map((value, index) => value + left.translation[index]);
  if (translation.some((value) => !Number.isFinite(value))) {
    throw new InputError('叠加后的平移超出浮点数范围，请减小输入数值。');
  }
  return { rotation, translation };
}

export function inverse(transform) {
  const [x, y, z, w] = transform.rotation;
  const rotation = normalizeQuaternion([-x, -y, -z, w]);
  const translation = multiplyVector(quaternionToMatrix(rotation), transform.translation).map((value) => -value);
  if (translation.some((value) => !Number.isFinite(value))) {
    throw new InputError('求逆后的平移超出浮点数范围，请减小输入数值。');
  }
  return { rotation, translation };
}

export function toMatrix4(transform) {
  return [...quaternionToMatrix(transform.rotation).map((row, index) => [...row, transform.translation[index]]), [0, 0, 0, 1]];
}

export function valuesForFormat(transform, formatId) {
  getFormat(formatId);
  const t = transform.translation;
  const q = normalizeQuaternion(transform.rotation);
  if (formatId === 'translation') return [...t];
  if (formatId === 'quat-xyzw') return q;
  if (formatId === 'quat-wxyz') return [q[3], ...q.slice(0, 3)];
  if (formatId === 'tum') return [...t, ...q];
  if (formatId === 'rpy') return quaternionToRPY(q).angles;
  if (formatId === 'ypr') return quaternionToRPY(q).angles.reverse();
  const matrix = formatId.startsWith('mat3') ? quaternionToMatrix(q) : toMatrix4(transform);
  return formatId.endsWith('col') ? matrix[0].flatMap((_, column) => matrix.map((row) => row[column])) : matrix.flat();
}

export function formatFloat(value, precision = 9) {
  if (!Number.isFinite(value)) throw new InputError('转换结果超出浮点数范围。');
  if (!Number.isInteger(precision) || precision < 1 || precision > 17) throw new InputError('显示精度须为 1–17 位有效数字。');
  if (value === 0) return '0.0';
  const [mantissa, exponent] = value.toPrecision(precision).split('e');
  let decimal = mantissa.includes('.') ? mantissa.replace(/0+$/, '').replace(/\.$/, '') : mantissa;
  if (!decimal.includes('.')) decimal += '.0';
  return exponent === undefined ? decimal : `${decimal}e${exponent}`;
}

export function serialize(transform, formatId, precision = 9) {
  const numbers = valuesForFormat(transform, formatId).map((value) => formatFloat(value, precision));
  if (!formatId.startsWith('mat')) return numbers.join(' ');
  const size = formatId.startsWith('mat3') ? 3 : 4;
  return Array.from({ length: size }, (_, index) => numbers.slice(index * size, (index + 1) * size).join(' ')).join('\n');
}
