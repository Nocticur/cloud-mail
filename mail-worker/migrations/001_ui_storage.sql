-- Additive UI storage for the existing Cloud Mail D1 database.
-- Back up D1 before applying. This does not initialize or alter mail/account tables.
CREATE TABLE IF NOT EXISTS ui_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES user(user_id) ON DELETE CASCADE,
  nickname TEXT NOT NULL CHECK (length(nickname) BETWEEN 1 AND 30),
  avatar_mime TEXT CHECK (avatar_mime IN ('image/png', 'image/jpeg', 'image/webp')),
  avatar BLOB CHECK (length(avatar) <= 131072),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((avatar IS NULL AND avatar_mime IS NULL) OR (avatar IS NOT NULL AND avatar_mime IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS ui_appearance (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  background TEXT NOT NULL CHECK (background IN ('gradient', 'color', 'image')),
  color TEXT NOT NULL,
  surface TEXT NOT NULL CHECK (surface IN ('solid', 'transparent', 'frosted')),
  opacity REAL NOT NULL CHECK (opacity BETWEEN 0.2 AND 1),
  blur REAL NOT NULL CHECK (blur BETWEEN 0 AND 40),
  image_mime TEXT CHECK (image_mime IN ('image/png', 'image/jpeg', 'image/webp')),
  image BLOB CHECK (length(image) <= 1048576),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((image IS NULL AND image_mime IS NULL) OR (image IS NOT NULL AND image_mime IS NOT NULL)),
  CHECK (background <> 'image' OR image IS NOT NULL)
);
