'use strict';

const CropTemplates = (() => {
  const get = id => document.getElementById(id);
  const storageKey = 'band-studio.crop-template.v1';
  const dialog = get('cropDialog');
  const overview = get('cropOverview');
  const result = get('cropResult');
  const auto = get('autoCrop');
  const maxSize = 2400;
  let active = null;
  let drag = null;
  let exporting = false;
  let redraw = 0;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const sourceSize = source => ({width: source.naturalWidth || source.width, height: source.naturalHeight || source.height});
  const validSize = value => Number.isInteger(value) && value >= 1 && value <= maxSize;
  let template = readTemplate();

  function readTemplate() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey));
      if (value && validSize(value.width) && validSize(value.height) && value.scale >= .25 && value.scale <= 4 &&
          value.rotation >= -180 && value.rotation <= 180 && value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1) return value;
    } catch {
      // A browser may block storage for local files or private sessions.
    }
    return null;
  }

  function saveTemplate() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(template));
      return true;
    } catch {
      return false;
    }
  }

  function refreshTemplateStatus() {
    auto.disabled = !template;
    auto.checked = template?.auto ?? false;
    get('templateStatus').textContent = template
      ? `模板 ${template.width} × ${template.height} px · ${auto.checked ? '导入时自动定位条带并裁切' : '可在裁切界面复用'}`
      : '从一张图片设定固定宽高，供后续图片使用。';
  }

  auto.addEventListener('change', () => {
    if (!template) return;
    template.auto = auto.checked;
    saveTemplate();
    refreshTemplateStatus();
  });

  function drawCrop(context, source, view, width, height) {
    const size = sourceSize(source);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.save();
    context.translate(width / 2, height / 2);
    context.scale(width / view.width, height / view.height);
    context.rotate(view.rotation * Math.PI / 180);
    context.scale(view.scale, view.scale);
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, -view.x * size.width, -view.y * size.height);
    context.restore();
  }

  function render(source, view) {
    const canvas = document.createElement('canvas');
    canvas.width = view.width;
    canvas.height = view.height;
    drawCrop(canvas.getContext('2d'), source, view, view.width, view.height);
    return canvas;
  }

  function constrain(source, view) {
    const {width, height} = sourceSize(source);
    const angle = view.rotation * Math.PI / 180;
    const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
    const padX = Math.min(.5, (view.width * cos + view.height * sin) / (2 * width * view.scale));
    const padY = Math.min(.5, (view.width * sin + view.height * cos) / (2 * height * view.scale));
    return {...view, x: clamp(view.x, padX, 1 - padX), y: clamp(view.y, padY, 1 - padY)};
  }

  function estimateBands(source, view) {
    const size = sourceSize(source);
    const scale = Math.min(1, 256 / Math.max(size.width, size.height));
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    if (width < 18 || height < 18) return null;
    const sample = document.createElement('canvas');
    sample.width = width;
    sample.height = height;
    const context = sample.getContext('2d', {willReadFrequently: true});
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const luminance = Float32Array.from({length: width * height}, (_, i) =>
      .2126 * rgba[4 * i] + .7152 * rgba[4 * i + 1] + .0722 * rgba[4 * i + 2]);
    const contrast = new Float32Array(width * height);

    // Horizontal smoothing followed by local contrast above and below each row.
    const smooth = new Float32Array(luminance.length);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 2; x < width - 2; x++) {
        smooth[row + x] = (luminance[row+x-2] + luminance[row+x-1] + luminance[row+x] + luminance[row+x+1] + luminance[row+x+2]) / 5;
      }
    }
    for (const radius of [3, 6, 10]) {
      for (let y = radius + 1; y < height - radius - 1; y++) {
        for (let x = 3; x < width - 3; x++) {
          const i = y * width + x;
          const above = smooth[i - radius * width];
          const below = smooth[i + radius * width];
          const dark = Math.min(above, below) - smooth[i];
          const bright = smooth[i] - Math.max(above, below);
          contrast[i] = Math.max(contrast[i], dark, bright * .85);
        }
      }
    }
    const components = [];
    const marked = new Uint8Array(contrast.length);
    for (let i = 0; i < contrast.length; i++) {
      if (marked[i] || contrast[i] < 9) continue;
      const queue = [i];
      marked[i] = 1;
      let x0 = width, x1 = 0, y0 = height, y1 = 0, weight = 0, sx = 0, sy = 0;
      for (let head = 0; head < queue.length; head++) {
        const index = queue[head], x = index % width, y = Math.floor(index / width);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        weight += contrast[index]; sx += x * contrast[index]; sy += y * contrast[index];
        for (const next of [index - 1, index + 1, index - width, index + width]) {
          if (!marked[next] && contrast[next] >= 9) {
            marked[next] = 1;
            queue.push(next);
          }
        }
      }
      const bandWidth = x1 - x0 + 1, bandHeight = y1 - y0 + 1;
      if (bandWidth >= 5 && bandWidth >= 1.7 * bandHeight && bandWidth < width * .75 && queue.length >= 7) {
        components.push({x: sx / weight / width, y: sy / weight / height, weight: Math.sqrt(weight)});
      }
    }
    if (!components.length) return null;

    // Prefer the neighborhood of the saved framing, while allowing the band to shift.
    const reachX = Math.max(.11, view.width / (size.width * view.scale) * .55);
    const reachY = Math.max(.09, view.height / (size.height * view.scale) * .55);
    const weighted = components.map(band => ({
      ...band,
      score: band.weight / (1 + ((band.x-view.x)/reachX)**2 + ((band.y-view.y)/reachY)**2)
    }));
    const seed = weighted.reduce((best, band) => band.score > best.score ? band : best);
    const group = weighted.filter(band => Math.abs(band.x-seed.x) < reachX && Math.abs(band.y-seed.y) < reachY);
    const total = group.reduce((sum, band) => sum + band.score, 0);
    return {
      x: group.reduce((sum, band) => sum + band.x * band.score, 0) / total,
      y: group.reduce((sum, band) => sum + band.y * band.score, 0) / total
    };
  }

  function autoView(source) {
    if (!template?.auto) return null;
    const view = {...template};
    const match = estimateBands(source, view);
    return {view: constrain(source, {...view, ...match}), found: Boolean(match)};
  }

  const fieldNames = ['cropWidth', 'cropHeight', 'cropRotation', 'cropScale'];
  function readFields() {
    if (!active || fieldNames.some(id => get(id).value === '' || !get(id).validity.valid)) return null;
    return {
      ...active.view,
      width: Number(get('cropWidth').value),
      height: Number(get('cropHeight').value),
      rotation: Number(get('cropRotation').value),
      scale: Number(get('cropScale').value) / 100
    };
  }

  function cropExportSettings() {
    const size = get('cropExportSize').value;
    const custom = size === 'custom';
    const input = get('cropExportCustom');
    get('cropExportCustomField').hidden = !custom;
    const format = get('cropFormat').value;
    get('cropQualityField').hidden = format !== 'jpg';
    if (custom && (!input.value || !input.validity.valid)) return null;
    return {format, longEdge: size === 'current' ? null : Number(custom ? input.value : size), quality: Number(get('cropQuality').value)};
  }

  function preview() {
    redraw = 0;
    if (!active) return;
    const view = readFields();
    const settings = cropExportSettings();
    for (const id of ['cropApply', 'cropSave', 'cropDetect']) get(id).disabled = !view;
    get('cropExport').disabled = !view || !settings || exporting;
    get('cropScaleValue').textContent = get('cropScale').value + '%';
    if (!view) return;
    active.view = constrain(active.source, view);
    const v = active.view;
    const source = active.source, size = sourceSize(source);
    const overviewScale = Math.min(1, 460 / Math.max(size.width, size.height));
    overview.width = Math.max(1, Math.round(size.width * overviewScale));
    overview.height = Math.max(1, Math.round(size.height * overviewScale));
    const context = overview.getContext('2d');
    context.drawImage(source, 0, 0, overview.width, overview.height);
    const w = v.width * overviewScale / v.scale, h = v.height * overviewScale / v.scale;
    context.translate(v.x * overview.width, v.y * overview.height);
    context.rotate(-v.rotation * Math.PI / 180);
    context.fillStyle = '#2475d14d';
    context.strokeStyle = '#2588ff';
    context.lineWidth = 2;
    context.fillRect(-w/2, -h/2, w, h);
    context.strokeRect(-w/2, -h/2, w, h);

    const previewScale = Math.min(1, 460 / Math.max(v.width, v.height));
    result.width = Math.max(1, Math.round(v.width * previewScale));
    result.height = Math.max(1, Math.round(v.height * previewScale));
    drawCrop(result.getContext('2d'), source, v, result.width, result.height);
  }

  function schedulePreview() {
    if (!redraw) redraw = requestAnimationFrame(preview);
  }

  function open({source, view, name, onApply}) {
    const {width, height} = sourceSize(source);
    const initial = view || template || {
      width: Math.max(1, Math.round(Math.min(maxSize, width * .8))),
      height: Math.max(1, Math.round(Math.min(maxSize, height * .8))),
      rotation: 0, scale: 1, x: .5, y: .5
    };
    active = {source, name, view: {...initial}, onApply};
    get('cropTitle').textContent = '裁切 · ' + name;
    get('cropWidth').value = initial.width;
    get('cropHeight').value = initial.height;
    get('cropRotation').value = initial.rotation;
    get('cropScale').value = Math.round(initial.scale * 100);
    get('cropStatus').textContent = '';
    dialog.showModal();
    preview();
  }

  function pointerPosition(event) {
    const rect = overview.getBoundingClientRect();
    return {x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height};
  }

  overview.addEventListener('pointerdown', event => {
    const view = readFields();
    if (!view || event.button !== 0 || drag) return;
    const p = pointerPosition(event);
    const size = sourceSize(active.source);
    const dx = (p.x-view.x)*size.width, dy = (p.y-view.y)*size.height;
    const angle = view.rotation * Math.PI / 180;
    const inside = Math.abs(dx*Math.cos(angle)-dy*Math.sin(angle)) <= view.width/(2*view.scale)
      && Math.abs(dx*Math.sin(angle)+dy*Math.cos(angle)) <= view.height/(2*view.scale);
    drag = {id: event.pointerId, offsetX: inside ? p.x-view.x : 0, offsetY: inside ? p.y-view.y : 0};
    overview.setPointerCapture(event.pointerId);
    moveFrame(event);
  });

  function moveFrame(event) {
    if (drag?.id !== event.pointerId) return;
    const p = pointerPosition(event);
    active.view = {...active.view, x: p.x-drag.offsetX, y: p.y-drag.offsetY};
    schedulePreview();
  }

  overview.addEventListener('pointermove', moveFrame);
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    overview.addEventListener(name, event => { if (drag?.id === event.pointerId) drag = null; });
  }
  for (const field of [...fieldNames, 'cropFormat', 'cropExportSize', 'cropExportCustom']) {
    get(field).addEventListener('input', schedulePreview);
  }

  get('cropDetect').onclick = () => {
    const view = readFields();
    if (!view) return;
    const match = estimateBands(active.source, view);
    if (match) {
      active.view = {...view, ...match};
      get('cropStatus').textContent = '已定位候选条带，请检查取景框，可拖动微调。';
      schedulePreview();
    } else get('cropStatus').textContent = '未检测到明显条带，请在左图手动定位。';
  };

  get('cropSave').onclick = () => {
    const view = readFields();
    if (!view) return;
    template = {...constrain(active.source, view), auto: true};
    const persisted = saveTemplate();
    refreshTemplateStatus();
    get('cropStatus').textContent = persisted ? '已保存模板并开启导入时自动裁切。' : '模板在本次打开期间有效，浏览器阻止了本地保存。';
  };

  get('cropApply').onclick = () => {
    const view = readFields();
    if (view && active.onApply(constrain(active.source, view))) dialog.close();
  };
  get('cropRestore').onclick = () => { if (active.onApply(null)) dialog.close(); };
  get('cropCancel').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { active = null; drag = null; });

  get('cropExport').onclick = async () => {
    const view = readFields(), settings = cropExportSettings();
    if (!view || !settings || exporting) return;
    const job = active;
    exporting = true;
    get('cropExport').disabled = true;
    get('cropStatus').textContent = '正在生成 300 DPI 截图…';
    try {
      const image = render(job.source, constrain(job.source, view));
      const blob = await ImageExport.encode(image, settings);
      const name = job.name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 100);
      ImageExport.download(blob, (name || 'band') + '-crop-300dpi.' + settings.format);
      if (active === job) get('cropStatus').textContent = '已下载单张 300 DPI 截图。';
    } catch (error) {
      console.error(error);
      if (active === job) get('cropStatus').textContent = '导出失败，请检查像素尺寸后重试。';
    } finally {
      exporting = false;
      if (active) schedulePreview();
    }
  };

  refreshTemplateStatus();
  return {open, autoView, render};
})();
