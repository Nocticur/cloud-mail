import { imageSize } from 'image-size';
import BizError from '../error/biz-error';

export function assertUi(condition, message, code = 400) {
  if (!condition) throw new BizError(message, code);
}

export async function uiInput(c) {
  const reader = c.req.raw.body?.getReader();
  assertUi(reader, '请求不是有效 JSON。');
  const decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_500_000) {
        await reader.cancel();
        throw new BizError('请求体超过大小限制。', 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const body = JSON.parse(text);
    assertUi(body && typeof body === 'object' && !Array.isArray(body), '请求格式无效。');
    assertUi(Number.isSafeInteger(body.version) && body.version >= 0, '版本无效，请刷新页面。');
    return body;
  } catch (error) {
    if (error instanceof BizError) throw error;
    throw new BizError('请求不是有效 JSON。', 400);
  } finally {
    reader.releaseLock();
  }
}

export function uiImage(value, avatar = false) {
  if (value === null || value === '') return { bytes: null, mime: null };
  assertUi(typeof value === 'string' && value.length <= (avatar ? 180_000 : 1_400_000), '图片超过大小限制。');
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  assertUi(match, '仅支持 PNG、JPEG、WebP 静态图片。');
  try {
    const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
    assertUi(bytes.length <= (avatar ? 128 * 1024 : 1024 * 1024), '图片超过大小限制。');
    const info = imageSize(bytes);
    assertUi((info.type === 'jpg' ? 'jpeg' : info.type) === match[1], '图片类型与内容不符。');
    const limit = avatar ? 256 : 2560;
    assertUi(info.width > 0 && info.height > 0 && info.width <= limit && info.height <= limit, '图片尺寸超过限制。');
    const view = new DataView(bytes.buffer);
    if (info.type === 'png') {
      for (let i = 8; i + 12 <= bytes.length;) {
        const name = String.fromCharCode(...bytes.slice(i + 4, i + 8));
        assertUi(name !== 'acTL', '不支持动态图片。');
        const size = view.getUint32(i);
        assertUi(i + 12 + size <= bytes.length, '图片已损坏。');
        i += 12 + size;
      }
    }
    if (info.type === 'webp') {
      for (let i = 12; i + 8 <= bytes.length;) {
        const name = String.fromCharCode(...bytes.slice(i, i + 4));
        assertUi(name !== 'ANIM' && name !== 'ANMF', '不支持动态图片。');
        const size = view.getUint32(i + 4, true);
        assertUi(i + 8 + size <= bytes.length, '图片已损坏。');
        i += 8 + size + (size % 2);
      }
    }
    return { bytes: bytes.buffer, mime: `image/${match[1]}` };
  } catch (error) {
    if (error instanceof BizError) throw error;
    throw new BizError('无法读取图片。', 400);
  }
}

export function uiAppearance(body) {
  assertUi(['gradient', 'color', 'image'].includes(body.background), '背景类型无效。');
  assertUi(['solid', 'transparent', 'frosted'].includes(body.surface), '卡片样式无效。');
  assertUi(typeof body.color === 'string' && /^#[a-f0-9]{6}$/i.test(body.color), '颜色无效。');
  assertUi(typeof body.opacity === 'number' && body.opacity >= 0.2 && body.opacity <= 1, '透明度应在 20% 到 100% 之间。');
  assertUi(typeof body.blur === 'number' && body.blur >= 0 && body.blur <= 40, '模糊程度应在 0 到 40 之间。');
  return { background: body.background, color: body.color, surface: body.surface, opacity: body.opacity, blur: body.blur };
}
