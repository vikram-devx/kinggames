/**
 * ONE-TIME DATA MIGRATION SCRIPT
 * Automatically runs once and deletes itself after successful migration
 */
import pkg from 'pg';
import fs from 'fs';
import path from 'path';
const { Pool } = pkg;

const NEON_CONNECTION = 'postgresql://neondb_owner:npg_0V1TaZlMieFf@ep-super-hill-aejxhohw-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require';
const RENDER_CONNECTION = process.env.DATABASE_URL;
const MIGRATION_FLAG_FILE = './migration-completed.flag';

if (!RENDER_CONNECTION) {
  console.error('❌ DATABASE_URL not set');
  process.exit(1);
}

// Check if migration already ran
if (fs.existsSync(MIGRATION_FLAG_FILE)) {
  console.log('✅ Migration already completed. Skipping...');
  process.exit(0);
}

async function migrateData() {
  const neonPool = new Pool({ 
    connectionString: NEON_CONNECTION, 
    ssl: { rejectUnauthorized: false } 
  });
  const renderPool = new Pool({ connectionString: RENDER_CONNECTION });

  try {
    console.log('🔌 Connecting to Neon and Render databases...\n');

    // Tables to copy in order (respecting foreign key constraints)
    const tablesToCopy = [
      'users',
      'satamatka_markets',
      'team_matches',
      'games',
      'wallet_requests',
      'transactions',
      'subadmin_commissions',
      'deposit_commissions',
      'user_discounts',
      'player_deposit_discounts',
      'game_odds',
      'system_settings'
    ];

    let totalRowsCopied = 0;

    for (const table of tablesToCopy) {
      console.log(`📊 Processing table: ${table}`);
      
      // Get data from Neon
      const neonResult = await neonPool.query(`SELECT * FROM ${table}`);
      const rowCount = neonResult.rowCount || 0;
      
      if (rowCount === 0) {
        console.log(`   ⏭️  Empty, skipping...\n`);
        continue;
      }

      console.log(`   📥 Found ${rowCount} rows in Neon`);

      let rowsToInsert = neonResult.rows;

      // Skip admin user if it already exists in render
      if (table === 'users') {
        const adminCheck = await renderPool.query('SELECT id FROM users WHERE username = $1', ['admin']);
        if (adminCheck.rowCount && adminCheck.rowCount > 0) {
          console.log('   ⚠️  Admin user exists in Render, filtering out from Neon data...');
          rowsToInsert = rowsToInsert.filter(row => row.username !== 'admin');
        }
      }

      // Insert data into Render
      let successCount = 0;
      for (const row of rowsToInsert) {
        try {
          const columns = Object.keys(row);
          const values = Object.values(row);
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
          
          const insertQuery = `
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES (${placeholders})
            ON CONFLICT DO NOTHING
          `;
          
          const result = await renderPool.query(insertQuery, values);
          if (result.rowCount && result.rowCount > 0) {
            successCount++;
          }
        } catch (err: any) {
          console.log(`   ⚠️  Failed to insert row: ${err.message}`);
        }
      }

      totalRowsCopied += successCount;
      console.log(`   ✅ Inserted ${successCount} rows into Render\n`);
    }

    console.log('═══════════════════════════════════════');
    console.log(`🎉 Migration completed successfully!`);
    console.log(`📊 Total rows copied: ${totalRowsCopied}`);
    console.log('═══════════════════════════════════════\n');
    
    // Create flag file to prevent re-running
    fs.writeFileSync(MIGRATION_FLAG_FILE, new Date().toISOString());
    console.log('✅ Migration flag created. This script will not run again.');

  } catch (error) {
    console.error('❌ Error during migration:', error);
    throw error;
  } finally {
    await neonPool.end();
    await renderPool.end();
  }
}

migrateData();
