import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from './index.js';
import { logger } from '../utils/logger.js';

let supabase: SupabaseClient | null = null;

export function initDatabase(): void {
  supabase = createClient(
    config.database.supabaseUrl,
    config.database.supabaseAnonKey
  );
  logger.info('Database client initialized');
}

export function getDatabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return supabase;
}

export async function testConnection(): Promise<boolean> {
  try {
    const db = getDatabase();
    const { error } = await db.from('agents').select('id').limit(1);
    if (error && error.code !== 'PGRST116') {
      throw error;
    }
    logger.info('Database connection successful');
    return true;
  } catch (error) {
    logger.error('Database connection failed:', error);
    return false;
  }
}
