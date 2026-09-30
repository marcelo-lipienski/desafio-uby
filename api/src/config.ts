const num = (v: string | undefined, padrao: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
};

export const config = {
  port: num(process.env.PORT, 3000),

  mysql: {
    host: process.env.MYSQL_HOST ?? 'localhost',
    port: num(process.env.MYSQL_PORT, 3306),
    user: process.env.MYSQL_USER ?? 'mobilidade',
    password: process.env.MYSQL_PASSWORD ?? 'mobilidade',
    database: process.env.MYSQL_DATABASE ?? 'mobilidade',
    connectionLimit: num(process.env.MYSQL_POOL, 12),
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: num(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  /** TTL da posicao em cache, em segundos. */
  posicaoTtl: num(process.env.POSICAO_TTL, 60),

  /** Intervalo do broadcast periódico de posições consolidadas (ms). */
  broadcastIntervalMs: num(process.env.BROADCAST_INTERVAL_MS, 2000),

  /** Frota sintetica que roda dentro da API para manter a malha populada. */
  frota: {
    tamanho: num(process.env.FLEET_SIZE, 32),
    pingMs: num(process.env.FLEET_PING_MS, 1000),
    cidadePadrao: num(process.env.FLEET_CITY, 1),
  },

  /** Token de autenticacao para conexoes e salas do painel. */
  panelToken: process.env.PANEL_TOKEN ?? 'painel-segredo-interno',

  logLevel: process.env.LOG_LEVEL ?? 'info',
};
