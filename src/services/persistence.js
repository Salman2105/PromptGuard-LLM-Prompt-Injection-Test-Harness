import mongoose from 'mongoose';
import { createTestResultModel } from '../models/testResult.js';

export async function createPersistence(uri, { connect, warn = console.warn } = {}) {
  if (!uri) {
    warn('Persistence disabled: MONGODB_URI is not configured.');
    return { status: 'disabled', async save() { return 'disabled'; }, async close() {} };
  }
  let connection;
  try {
    const options = { serverSelectionTimeoutMS: 1500, connectTimeoutMS: 1500, socketTimeoutMS: 2000, maxPoolSize: 2 };
    if (connect) connection = await connect(options);
    else {
      connection = mongoose.createConnection(uri, options);
      await connection.asPromise();
    }
    // Avoid logging raw driver errors, which may contain connection details.
    connection.on('error', () => {});
    const model = createTestResultModel(connection);
    return {
      status: 'available',
      async save(result) {
        try { await model.create(result); return 'saved'; }
        catch { warn('Persistence unavailable: result was not saved.'); return 'unavailable'; }
      },
      async close() { await connection.close(); },
    };
  } catch {
    if (connection) await connection.close().catch(() => {});
    warn('Persistence unavailable: MongoDB connection failed.');
    return { status: 'unavailable', async save() { return 'unavailable'; }, async close() {} };
  }
}
