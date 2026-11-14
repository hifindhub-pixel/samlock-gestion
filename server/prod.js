// Démarrage production compatible Windows / Mac / Linux (évite la syntaxe NODE_ENV=… qui échoue sous cmd.exe).
process.env.NODE_ENV = 'production';
await import('./index.js');
