# Fix "bad auth : authentication failed"

Do these in **MongoDB Atlas** (cloud.mongodb.com), then update your `.env`.

## 1. Reset the database user password (recommended)

1. In Atlas: **Database Access** (left sidebar) → click user **jiayinli905_db_user** → **Edit**.
2. Click **Edit Password**.
3. Set a **new password using only letters and numbers** (e.g. `Bunker2025` or `Android123`) — no `!@#` — then **Update**.

## 2. Update `.env` with the new password

If you chose a simple password (e.g. `Bunker2025`), in `.env` set:

```env
MONGODB_PASSWORD=Bunker2025
```

No URL encoding needed. Restart the server (`npm run dev`).

If you keep a password with special characters, it must be URL-encoded in the URI when using `MONGODB_URI` directly: `!` → `%21`, `@` → `%40`, `#` → `%23`.

## 3. Confirm user and cluster

- **Database Access**: User **jiayinli905_db_user** must exist and have **Atlas admin** or **Read and write to any database**.
- **Network Access**: **Add IP Address** → **Allow Access from Anywhere** (`0.0.0.0/0`) so your app can connect.
- **Clusters**: The host in your URI (e.g. `bunker.zt6ea5o.mongodb.net`) must match a cluster in the **same project** where this user was created.

## 4. Use connection string from Atlas (optional)

1. In Atlas: **Database** → **Connect** on your cluster → **Drivers** → **Node.js**.
2. Copy the URI and replace `<password>` with your **new** password (no encoding if it’s simple).
3. Insert `/bunker` before `?` (database name) and add `&authSource=admin` in the query string.
4. In `.env` set that full URI and comment out `MONGODB_USER`, `MONGODB_PASSWORD`, `MONGODB_HOST`, `MONGODB_DB`:

```env
MONGODB_URI=mongodb+srv://jiayinli905_db_user:Bunker2025@bunker.zt6ea5o.mongodb.net/bunker?retryWrites=true&w=majority&authSource=admin
```

Then restart the server.
