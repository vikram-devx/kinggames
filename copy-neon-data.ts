/**
 * Script to copy data from Neon database to Render Postgres
 * Run this script once to migrate existing data
 */
import pkg from 'pg';
const { Pool } = pkg;

const NEON_CONNECTION = 'postgresql://neondb_owner:npg_0V1TaZlMieFf@ep-super-hill-aejxhohw-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require';
const RENDER_CONNECTION = process.env.DATABASE_URL;

if (!RENDER_CONNECTION) {
  console.error('❌ DATABASE_URL not set');
  process.exit(1);
}

async function copyData() {
  const neonPool = new Pool({ connectionString: NEON_CONNECTION, ssl: { rejectUnauthorized: false } });
  const renderPool = new Pool({ connectionString: RENDER_CONNECTION });

  try {
    console.log('🔌 Connecting to both databases...\n');

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

    for (const table of tablesToCopy) {
      console.log(`📊 Copying table: ${table}`);
      
      // Get data from Neon
      const neonResult = await neonPool.query(`SELECT * FROM ${table}`);
      const rowCount = neonResult.rowCount || 0;
      
      if (rowCount === 0) {
        console.log(`   ⏭️  Table ${table} is empty, skipping...\n`);
        continue;
      }

      console.log(`   📥 Found ${rowCount} rows`);

      // Skip admin user if it already exists in render
      if (table === 'users') {
        const adminCheck = await renderPool.query('SELECT id FROM users WHERE username = $1', ['admin']);
        if (adminCheck.rowCount > 0) {
          console.log('   ⚠️  Admin user already exists, filtering out...');
          neonResult.rows = neonResult.rows.filter(row => row.username !== 'admin');
        }
      }

      // Insert data into Render
      for (const row of neonResult.rows) {
        const columns = Object.keys(row);
        const values = Object.values(row);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        
        const insertQuery = `
          INSERT INTO ${table} (${columns.join(', ')})
          VALUES (${placeholders})
          ON CONFLICT DO NOTHING
        `;
        
        await renderPool.query(insertQuery, values);
      }

      console.log(`   ✅ Copied ${neonResult.rows.length} rows to ${table}\n`);
    }

    console.log('🎉 Data migration completed successfully!');

  } catch (error) {
    console.error('❌ Error during migration:', error);
    throw error;
  } finally {
    await neonPool.end();
    await renderPool.end();
  }
}

copyData();
