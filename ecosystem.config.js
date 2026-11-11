// pm2 (no Docker):   npm i -g pm2 && pm2 start ecosystem.config.js && pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'newyear-bot',
      script: 'index.js',
      autorestart: true,
      max_memory_restart: '400M',
      restart_delay: 3000,
      env: { NODE_ENV: 'production' },
    },
  ],
};
