const DB_PATH = process.env.EDHELPER_DB ?? 'D:\\EDHelper\\data\\ed.db';
process.stdout.write(JSON.stringify({ event: 'ready', data: { dbPath: DB_PATH } }) + '\n');
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
