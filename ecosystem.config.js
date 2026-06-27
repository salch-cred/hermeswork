module.exports = {
  apps: [
    {
      name: 'hermeswork-backend',
      script: './backend/server.js',
      env: { PORT: 3500, NODE_ENV: 'production' },
      watch: false,
      max_restarts: 10,
      restart_delay: 3000,
      error_file: './logs/backend-error.log',
      out_file: './logs/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    },
    {
      name: 'hermeswork-telegram',
      script: './telegram/bot.js',
      env: { NODE_ENV: 'production' },
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      error_file: './logs/telegram-error.log',
      out_file: './logs/telegram-out.log'
    }
  ]
};
