import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

export const JWT_SECRET = process.env.JWT_SECRET || 'poshere_super_secret_jwt_key_2026_modern_pos_auth';
export const NEON_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_u9ERC0mWqNpM@ep-lingering-tree-b8tc55nw-pooler.c-14.us-east-1.aws.neon.tech/neondb?sslmode=require';

export const sql = neon(NEON_DATABASE_URL);
