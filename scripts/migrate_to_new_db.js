import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const doliaRoot = path.join(__dirname, '..');

dotenv.config({ path: path.join(doliaRoot, '.env') });

const OLD_URI = process.env.OLD_MONGO_URI;
const NEW_URI = process.env.MONGO_URI;

if (!OLD_URI || !NEW_URI) {
  console.error('❌ Missing OLD_MONGO_URI or MONGO_URI in .env');
  process.exit(1);
}

const modelsDir = path.join(doliaRoot, 'models');
const modelFiles = fs.readdirSync(modelsDir).filter(f => f.endsWith('.js'));

async function migrate() {
  console.log('===================================================');
  console.log('       DOLIA DATABASE MIGRATION SCRIPT             ');
  console.log('===================================================');
  console.log(`[Source] OLD_MONGO_URI: ${OLD_URI.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`[Dest]   MONGO_URI:     ${NEW_URI.replace(/:[^:@]+@/, ':***@')}`);
  console.log('');

  // 1. Discover all Dolia models & collection names
  const modelInfo = [];
  for (const file of modelFiles) {
    const mod = await import(`file://${path.join(modelsDir, file).replace(/\\/g, '/')}`);
    const model = mod.default || mod;
    if (model && model.modelName) {
      modelInfo.push({
        file,
        modelName: model.modelName,
        collectionName: model.collection.name
      });
    }
  }

  const doliaCollections = new Set(modelInfo.map(m => m.collectionName));
  console.log(`[*] Discovered ${modelInfo.length} models (${doliaCollections.size} collections) in Dolia/models:\n`, Array.from(doliaCollections).join(', '));
  console.log('');

  // 2. Connect to both databases
  console.log('[*] Connecting to MongoDB clusters...');
  const oldConn = await mongoose.createConnection(OLD_URI, { serverSelectionTimeoutMS: 10000 }).asPromise();
  const newConn = await mongoose.createConnection(NEW_URI, { serverSelectionTimeoutMS: 10000 }).asPromise();
  console.log('✅ Connected successfully to both old and new databases.\n');

  // 3. Migrate each Dolia collection
  console.log('--- Migrating Dolia Model Collections ---');
  const results = [];

  for (const colName of doliaCollections) {
    try {
      const oldCol = oldConn.db.collection(colName);
      const newCol = newConn.db.collection(colName);

      const oldDocs = await oldCol.find({}).toArray();
      const oldCount = oldDocs.length;
      let migratedCount = 0;

      if (oldCount > 0) {
        // Upsert documents using bulkWrite
        const ops = oldDocs.map(doc => {
          const filter = (colName === 'commands' && doc.name) ? { name: doc.name } : { _id: doc._id };
          const updateDoc = { ...doc };
          if (colName === 'commands') delete updateDoc._id; // avoid altering existing _id in dest
          return {
            updateOne: {
              filter: filter,
              update: { $set: updateDoc },
              upsert: true
            }
          };
        });

        const bulkRes = await newCol.bulkWrite(ops);
        migratedCount = (bulkRes.upsertedCount || 0) + (bulkRes.modifiedCount || 0) + (bulkRes.matchedCount || 0);

        // Copy indexes (ignoring _id_)
        try {
          const indexes = await oldCol.indexes();
          for (const idx of indexes) {
            if (idx.name === '_id_') continue;
            const keys = idx.key;
            const options = { name: idx.name };
            if (idx.unique) options.unique = true;
            if (idx.sparse) options.sparse = true;
            if (idx.expireAfterSeconds !== undefined) options.expireAfterSeconds = idx.expireAfterSeconds;
            await newCol.createIndex(keys, options);
          }
        } catch (idxErr) {
          console.warn(`  ⚠️ Warning copying indexes for ${colName}:`, idxErr.message);
        }
      }

      const newTotal = await newCol.countDocuments();
      results.push({
        collection: colName,
        sourceCount: oldCount,
        destTotal: newTotal,
        status: oldCount > 0 ? `✅ Migrated ${oldCount} docs` : '⚪ Empty in source'
      });
      console.log(`  [${colName.padEnd(18)}] Source: ${oldCount.toString().padStart(4)} | Dest Total: ${newTotal.toString().padStart(4)} | ${results[results.length - 1].status}`);
    } catch (colErr) {
      console.error(`  ❌ Error migrating ${colName}:`, colErr.message);
      results.push({
        collection: colName,
        sourceCount: 'Error',
        destTotal: 'Error',
        status: `❌ Failed: ${colErr.message}`
      });
    }
  }

  // 4. Check if there are other collections in old DB that had data
  console.log('\n--- Checking Non-Model Collections in Source DB ---');
  const allOldCols = await oldConn.db.listCollections().toArray();
  for (const c of allOldCols) {
    if (!doliaCollections.has(c.name)) {
      const cnt = await oldConn.db.collection(c.name).countDocuments();
      if (cnt > 0) {
        console.log(`  ℹ️ Other source collection: ${c.name} (${cnt} docs) - not in Dolia models`);
      }
    }
  }

  await oldConn.close();
  await newConn.close();
  console.log('\n===================================================');
  console.log('✅ Migration completed successfully!');
  console.log('===================================================');
}

migrate().catch(err => {
  console.error('❌ Fatal Migration Error:', err);
  process.exit(1);
});
