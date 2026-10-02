import app from '../hono/hono';
import result from '../model/result';
import uiService from '../service/ui-service';
import { assertUi, uiInput } from '../service/ui-validation';

const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
};

function route(handler) {
  return async c => {
    Object.entries(headers).forEach(([key, value]) => c.header(key, value));
    try {
      return await handler(c);
    } catch (error) {
      const code = error.name === 'BizError' ? error.code : 503;
      if (code === 503) console.error(JSON.stringify({ event: 'ui_storage_unavailable', errorType: error.name }));
      return c.json({ code, message: code === 503 ? '界面存储暂不可用，请检查 D1 绑定及迁移。' : error.message, data: null }, code);
    }
  };
}

async function image(c, value) {
  assertUi(value?.image && value.mime, '图片不存在。', 404);
  const bytes = new Uint8Array(value.image);
  c.header('Content-Type', value.mime);
  return c.body(bytes);
}

app.get('/ui/profile', route(async c => c.json(result.ok(await uiService.profile(c)))));
app.put('/ui/profile', route(async c => c.json(result.ok(await uiService.setProfile(c, await uiInput(c))))));
app.get('/ui/appearance', route(async c => c.json(result.ok(await uiService.appearance(c)))));
app.put('/ui/appearance', route(async c => c.json(result.ok(await uiService.setAppearance(c, await uiInput(c))))));
app.get('/ui/images/avatar', route(async c => image(c, await uiService.avatar(c))));
app.get('/ui/images/background', route(async c => image(c, await uiService.background(c))));
