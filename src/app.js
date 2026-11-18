import { FORMATS, extractNumbers, getFormat, formatFloat, quaternionToRPY, serialize } from './math.js';
import { DIRECTIONS, TransformModel } from './model.js';
import { FrameViewer } from './viewer.js';

const model = new TransformModel();
const $ = (id) => document.getElementById(id);
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const directionLabel = (direction) => `${DIRECTIONS[direction].source} → ${DIRECTIONS[direction].target}`;
const shortFormats = {
  translation: 'Translation',
  'quat-xyzw': 'Quat. XYZW',
  'quat-wxyz': 'Quat. WXYZ',
  rpy: 'RPY (ROS)', ypr: 'YPR',
  'mat3-row': '3×3 行主序', 'mat3-col': '3×3 列主序',
  'mat4-row': '4×4 行主序', 'mat4-col': '4×4 列主序',
  tum: 'TUM',
};
const outputCards = new Map();
let viewer;
let toastTimer;

for (const format of FORMATS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'format-button';
  button.dataset.format = format.id;
  button.title = `应用 ${format.label} ${format.layout} · ${format.count} 个数字`;
  button.setAttribute('aria-label', button.title);
  button.textContent = shortFormats[format.id];
  button.addEventListener('click', () => { model.applyFormat(format.id); render(); });
  $('format-buttons').append(button);

  const card = document.createElement('article');
  card.className = `result-card ${format.group}`;
  card.dataset.format = format.id;
  const header = document.createElement('div');
  header.className = 'result-card-header';
  const title = document.createElement('h3');
  title.textContent = format.label;
  const copy = document.createElement('button');
  copy.type = 'button'; copy.className = 'copy-button';
  copy.setAttribute('aria-label', `复制 ${format.label} ${format.layout}`);
  copy.title = `复制 ${format.layout}`;
  copy.innerHTML = icon('copy');
  copy.addEventListener('click', () => copyOutput(format.id, copy));
  const layout = document.createElement('div'); layout.className = 'result-layout'; layout.textContent = format.layout;
  layout.title = format.layout;
  header.append(title, layout, copy);
  const value = document.createElement('pre'); value.setAttribute('aria-label', `${format.label} 结果`);
  card.append(header, value);
  $('results-grid').append(card);
  outputCards.set(format.id, { card, value, copy });
}

for (let precision = 1; precision <= 17; precision++) {
  const option = document.createElement('option'); option.value = precision; option.textContent = precision;
  $('precision').append(option);
}
$('precision').value = model.precision;
$('input-values').value = model.draft;

try { viewer = new FrameViewer($('frame-canvas')); }
catch (error) {
  $('viewer-error').textContent = `三维画布不可用：${error.message} 数值转换仍可使用。`;
  $('viewer-error').hidden = false;
  $('frame-canvas').hidden = true;
  $('fit-view').disabled = true; $('reset-view').disabled = true;
  document.querySelectorAll('[data-view]').forEach((button) => { button.disabled = true; });
}

function renderDraft() {
  const { draft, draftError } = model;
  const count = extractNumbers(draft).length;
  const required = draftError?.required;
  $('input-count').textContent = required ? `${count} / ${required} 个数字` : `${count} 个数字`;
  $('input-count').classList.toggle('invalid', Boolean(draftError));
  $('input-shell').classList.toggle('invalid', Boolean(draftError));
  $('input-values').setAttribute('aria-invalid', String(Boolean(draftError)));
  $('input-message').textContent = draftError?.message ?? '';
  $('input-status').hidden = !draftError;
}

function render() {
  renderDraft();
  const { result, outputDirection } = model;
  $('inverse-button').disabled = !result;
  for (const direction of Object.keys(DIRECTIONS)) {
    $(`${direction}-button`).setAttribute('aria-pressed', String(direction === outputDirection));
  }
  $('result-direction').textContent = directionLabel(outputDirection);
  $('result-formula').textContent = result ? DIRECTIONS[outputDirection].formula : '尚无结果';
  for (const [id, output] of outputCards) {
    output.card.classList.toggle('empty', !result);
    output.value.textContent = result ? serialize(result, id, model.precision) : '—';
    output.copy.disabled = !result;
  }
  const notices = [...model.notices];
  if (result && model.precision < 6) notices.push('当前显示精度较低，复制的矩阵经舍入后可能无法通过旋转校验；需要再次输入时建议使用 9–17 位。');
  if (result && quaternionToRPY(result.rotation).gimbalLock) notices.push('当前旋转处于万向节锁位置：欧拉角解不唯一，输出固定 roll = 0°；四元数与矩阵仍有效。');
  $('output-notice').textContent = notices.join(' ');
  $('output-notice').hidden = !notices.length;
  renderScene();
}

function renderScene() {
  const { scene, referenceFrame } = model;
  $('reference-frame').value = referenceFrame;
  const translation = scene?.pose.translation.map((value) => formatFloat(value, 6)).join(', ');
  $('translation-caption').textContent = scene ? `${scene.target} 原点在 ${scene.source} 中的位置` : '相对平移';
  $('translation-reading').textContent = translation ?? '—';
  $('frame-canvas').setAttribute('aria-label', scene
    ? `${scene.source} 固定为基准，${scene.target} 原点相对平移 ${translation}。拖动旋转，滚轮缩放，右键平移；方向键旋转，加减号缩放，F 适应视图，R 复位。`
    : '尚无空间关系');
  $('viewer-empty').hidden = Boolean(scene) || !viewer;
  viewer?.setScene(scene);
}

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2600);
}

async function copyOutput(formatId, button) {
  const { result, outputDirection } = model;
  if (!result) return;
  const text = serialize(result, formatId, model.precision);
  let copied = false;
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); copied = true; } catch { /* Try the selection fallback. */ }
  }
  if (!copied) {
    const previousFocus = document.activeElement;
    const selection = document.createElement('textarea');
    selection.value = text;
    selection.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    selection.setAttribute('readonly', ''); document.body.append(selection); selection.select();
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    selection.remove(); previousFocus?.focus({ preventScroll: true });
  }
  if (copied) {
    button.innerHTML = icon('check'); button.classList.add('copied');
    setTimeout(() => { button.innerHTML = icon('copy'); button.classList.remove('copied'); }, 1500);
    toast(`已复制 ${getFormat(formatId).label} · ${directionLabel(outputDirection)}`);
  } else toast('复制未获浏览器允许，请选中结果文本手动复制。');
}

$('input-values').addEventListener('input', (event) => { model.setDraft(event.target.value); renderDraft(); });
$('precision').addEventListener('change', (event) => { model.precision = Number(event.target.value); render(); });
$('reference-frame').addEventListener('change', (event) => { model.selectReferenceFrame(event.target.value); renderScene(); });
$('identity-button').addEventListener('click', () => { model.resetIdentity(); render(); });
$('clear-result-button').addEventListener('click', () => {
  model.clearResult();
  clearTimeout(toastTimer);
  $('toast').hidden = true;
  render();
});
$('inverse-button').addEventListener('click', () => { model.invertOutput(); render(); });
for (const direction of Object.keys(DIRECTIONS)) {
  $(`${direction}-button`).addEventListener('click', () => { model.selectOutputDirection(direction); render(); });
}
function activateView(view) {
  for (const button of document.querySelectorAll('[data-view]')) {
    button.classList.toggle('active', button.dataset.view === view);
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
}
document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => { viewer?.setView(button.dataset.view); activateView(button.dataset.view); });
});
$('fit-view').addEventListener('click', () => viewer?.fit());
$('reset-view').addEventListener('click', () => { viewer?.reset(); activateView('isometric'); });
$('frame-canvas').addEventListener('pointerdown', () => activateView(null));
$('frame-canvas').addEventListener('keydown', (event) => {
  if (event.key.startsWith('Arrow')) activateView(null);
  if (event.key.toLowerCase() === 'r') activateView('isometric');
});

render();
