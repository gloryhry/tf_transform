import { FORMATS, extractNumbers, getFormat, formatFloat, quaternionToRPY, serialize } from './math.js';
import { DIRECTIONS, TransformModel } from './model.js';
import { FrameViewer } from './viewer.js';

const model = new TransformModel();
const $ = (id) => document.getElementById(id);
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const directionLabel = (direction) => `${DIRECTIONS[direction].source} → ${DIRECTIONS[direction].target}`;
const shortFormats = {
  translation: 'Translation',
  'quat-xyzw': 'Quat XYZW', 'quat-wxyz': 'Quat WXYZ',
  rpy: 'RPY (ROS)', ypr: 'YPR',
  'mat3-row': '3×3 行主序', 'mat3-col': '3×3 列主序',
  'mat4-row': '4×4 行主序', 'mat4-col': '4×4 列主序',
  tum: 'TUM',
};
const FORMAT_GROUPS = [['vector', '平移'], ['quaternion', '四元数'], ['euler', '欧拉角'], ['pose', '位姿'], ['matrix', '矩阵']];
const CARD_ORDER = ['tum', 'translation', 'rpy', 'ypr', 'quat-xyzw', 'quat-wxyz', 'mat3-row', 'mat3-col', 'mat4-row', 'mat4-col'];
const THEMES = { auto: ['auto', '跟随系统'], light: ['sun', '亮色'], dark: ['moon', '暗色'] };
const THEME_KEY = 'tf-translate-theme';
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const outputCards = new Map();
const formatButtons = new Map();
let viewer;
let toastTimer;
let themePreference = 'auto';
try { themePreference = localStorage.getItem(THEME_KEY) ?? 'auto'; } catch { /* Storage may be blocked. */ }
if (!['auto', 'light', 'dark'].includes(themePreference)) themePreference = 'auto';

for (const [groupId, groupLabel] of FORMAT_GROUPS) {
  const formats = FORMATS.filter((format) => format.group === groupId);
  const group = document.createElement('div');
  group.className = 'format-group';
  group.dataset.group = groupId;
  group.style.setProperty('--n', formats.length);
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', groupLabel);
  for (const format of formats) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'format-button';
    button.dataset.format = format.id;
    button.title = `应用 ${format.label} ${format.layout} · ${format.count} 个数字`;
    button.setAttribute('aria-label', button.title);
    button.innerHTML = `<span class="format-name">${shortFormats[format.id]}</span><span class="format-count" aria-hidden="true">${format.count}</span>`;
    button.addEventListener('click', () => { model.applyFormat(format.id); render(); });
    group.append(button);
    formatButtons.set(format.id, button);
  }
  $('format-buttons').append(group);
}

for (const format of CARD_ORDER.map(getFormat)) {
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

function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = themePreference === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : themePreference;
  const [iconName, label] = THEMES[themePreference];
  $('theme-button').innerHTML = icon(iconName);
  $('theme-button').title = `主题：${label}（点击切换）`;
  $('theme-button').setAttribute('aria-label', $('theme-button').title);
  const css = getComputedStyle(root);
  const value = (name) => css.getPropertyValue(`--${name}`).trim();
  document.querySelector('meta[name="theme-color"]').content = value('bg');
  viewer?.setPalette({
    axes: ['axis-x', 'axis-y', 'axis-z'].map(value), grid: value('viewer-grid'), gridMajor: value('viewer-grid-major'),
    link: value('viewer-link'), halo: value('viewer-bg'), labelBackground: value('viewer-label-bg'),
    robot: { point: value('frame-robot'), border: value('frame-robot-line'), text: value('frame-robot-text') },
    camera: { point: value('frame-camera'), border: value('frame-camera-line'), text: value('frame-camera-text') },
  });
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
  for (const format of FORMATS) formatButtons.get(format.id).classList.toggle('match', count > 0 && count === format.count);
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
  for (const button of document.querySelectorAll('[data-reference]')) {
    button.setAttribute('aria-pressed', String(button.dataset.reference === referenceFrame));
  }
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
document.querySelectorAll('[data-reference]').forEach((button) => {
  button.addEventListener('click', () => { model.selectReferenceFrame(button.dataset.reference); renderScene(); });
});
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
$('theme-button').addEventListener('click', () => {
  const order = Object.keys(THEMES);
  themePreference = order[(order.indexOf(themePreference) + 1) % order.length];
  try {
    if (themePreference === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, themePreference);
  } catch { /* Storage may be blocked. */ }
  applyTheme();
});
darkQuery.addEventListener('change', () => { if (themePreference === 'auto') applyTheme(); });
const guide = $('guide');
let backdropPress = false;
$('guide-button').addEventListener('click', () => guide.showModal());
$('guide-close').addEventListener('click', () => guide.close());
guide.addEventListener('pointerdown', (event) => { backdropPress = event.target === guide; });
guide.addEventListener('click', (event) => {
  if (backdropPress && event.target === guide) guide.close();
  backdropPress = false;
});

applyTheme();
render();
