import userContext from '../security/user-context';
import permService from './perm-service';
import { assertUi, uiAppearance, uiImage } from './ui-validation';

const defaultAppearance = { background: 'gradient', color: '#eaf2f7', surface: 'frosted', opacity: 0.88, blur: 20, version: 0 };
const profileView = row => ({ nickname: row.nickname, version: row.version, ...(row.avatar_mime ? { avatar: `/api/ui/images/avatar?v=${row.version}` } : {}) });
const appearanceView = row => row ? {
  background: row.background, color: row.color, surface: row.surface, opacity: row.opacity, blur: row.blur, version: row.version,
  ...(row.image_mime ? { image: `/api/ui/images/background?v=${row.version}` } : {}),
} : { ...defaultAppearance };

async function activeUser(c) {
  const userId = userContext.getUserId(c);
  assertUi(Number.isSafeInteger(userId) && userId > 0, '登录已失效，请重新登录。', 401);
  const user = await c.env.db.prepare('SELECT user_id, email FROM user WHERE user_id = ? AND status = 0 AND is_del = 0').bind(userId).first();
  assertUi(user, '登录已失效，请重新登录。', 401);
  return user;
}

const uiService = {
  async profile(c) {
    const user = await activeUser(c);
    const saved = await c.env.db.prepare('SELECT nickname, avatar_mime, version FROM ui_profiles WHERE user_id = ?').bind(user.user_id).first();
    if (saved) return profileView(saved);
    const account = await c.env.db.prepare('SELECT name FROM account WHERE user_id = ? AND email = ? AND is_del = 0 LIMIT 1').bind(user.user_id, user.email).first();
    return { nickname: account?.name || user.email.split('@')[0], version: 0 };
  },

  async setProfile(c, body) {
    const user = await activeUser(c);
    assertUi(typeof body.nickname === 'string' && body.nickname.trim().length >= 1 && body.nickname.trim().length <= 30, '昵称需要 1–30 个字符。');
    const replaceImage = body.avatar !== undefined;
    const image = replaceImage ? uiImage(body.avatar, true) : { bytes: null, mime: null };
    // INSERT and compare-and-set UPDATE are one statement, including the first write.
    const saved = await c.env.db.prepare(`
      INSERT INTO ui_profiles (user_id, nickname, avatar_mime, avatar, version)
      SELECT ?, ?, ?, ?, 1
      WHERE ? = 0 OR EXISTS (SELECT 1 FROM ui_profiles WHERE user_id = ? AND version = ?)
      ON CONFLICT(user_id) DO UPDATE SET
        nickname = excluded.nickname,
        avatar_mime = CASE WHEN ? THEN excluded.avatar_mime ELSE ui_profiles.avatar_mime END,
        avatar = CASE WHEN ? THEN excluded.avatar ELSE ui_profiles.avatar END,
        version = ui_profiles.version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE ui_profiles.version = ?
      RETURNING nickname, avatar_mime, version
    `).bind(user.user_id, body.nickname.trim(), image.mime, image.bytes, body.version, user.user_id, body.version, replaceImage ? 1 : 0, replaceImage ? 1 : 0, body.version).first();
    assertUi(saved, '资料已在其他窗口修改，请刷新后重试。', 409);
    return profileView(saved);
  },

  async appearance(c) {
    const saved = await c.env.db.prepare('SELECT background, color, surface, opacity, blur, image_mime, version FROM ui_appearance WHERE id = 1').first();
    return appearanceView(saved);
  },

  async setAppearance(c, body) {
    const user = await activeUser(c);
    const keys = user.email === c.env.admin ? ['*'] : await permService.userPermKeys(c, user.user_id);
    assertUi(keys.includes('*') || keys.includes('setting:set'), '当前账号没有此操作权限。', 403);
    const value = uiAppearance(body);
    const saved = await c.env.db.prepare('SELECT image_mime, version FROM ui_appearance WHERE id = 1').first();
    // Clearing an image when choosing another background frees its BLOB immediately.
    const replaceImage = value.background !== 'image' || body.image !== undefined;
    const image = value.background === 'image' && replaceImage ? uiImage(body.image) : { bytes: null, mime: null };
    assertUi(value.background !== 'image' || (replaceImage ? image.bytes : saved?.image_mime), '请先上传背景图片。');
    const updated = await c.env.db.prepare(`
      INSERT INTO ui_appearance (id, background, color, surface, opacity, blur, image_mime, image, version)
      SELECT 1, ?, ?, ?, ?, ?,
        CASE WHEN ? THEN ? ELSE (SELECT image_mime FROM ui_appearance WHERE id = 1) END,
        CASE WHEN ? THEN ? ELSE (SELECT image FROM ui_appearance WHERE id = 1) END, 1
      WHERE ? = 0 OR EXISTS (SELECT 1 FROM ui_appearance WHERE id = 1 AND version = ?)
      ON CONFLICT(id) DO UPDATE SET
        background = excluded.background, color = excluded.color, surface = excluded.surface,
        opacity = excluded.opacity, blur = excluded.blur,
        image_mime = CASE WHEN ? THEN excluded.image_mime ELSE ui_appearance.image_mime END,
        image = CASE WHEN ? THEN excluded.image ELSE ui_appearance.image END,
        version = ui_appearance.version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE ui_appearance.version = ?
      RETURNING background, color, surface, opacity, blur, image_mime, version
    `).bind(value.background, value.color, value.surface, value.opacity, value.blur, replaceImage ? 1 : 0, image.mime, replaceImage ? 1 : 0, image.bytes, body.version, body.version, replaceImage ? 1 : 0, replaceImage ? 1 : 0, body.version).first();
    assertUi(updated, '外观已在其他窗口修改，请刷新后重试。', 409);
    return appearanceView(updated);
  },

  async avatar(c) {
    const user = await activeUser(c);
    return c.env.db.prepare('SELECT avatar AS image, avatar_mime AS mime FROM ui_profiles WHERE user_id = ?').bind(user.user_id).first();
  },

  async background(c) {
    return c.env.db.prepare("SELECT image, image_mime AS mime FROM ui_appearance WHERE id = 1 AND background = 'image'").first();
  },
};

export default uiService;
