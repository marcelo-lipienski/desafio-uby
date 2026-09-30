import type { Server, Socket } from 'socket.io';
import { config } from '../../config.js';
import { Logger } from '../../infra/logger.js';
import { EventsEmitter } from './events.emitter.js';
import { EventsRoomService, Sala } from './events.rooms.js';
import type { DriverService, AtualizacaoPosicaoDto } from '../driver/driver.service.js';
import type { TelemetryService } from '../telemetry/telemetry.service.js';
import type { TelemetryExporter } from '../telemetry/telemetry.exporter.js';

// contadores de sessao. ja teve dashboard lendo isso, hoje nao tem mais
let totalConn = 0;
let totalDisc = 0;
let ultimoErro: any = null;

export class EventsGateway {
  private readonly logger = new Logger('EventsGateway');
  private readonly cidadesAtivas = new Set<number>();
  private cicloBroadcast: NodeJS.Timeout | null = null;
  private readonly intervaloBroadcastMs: number;

  constructor(
    private readonly io: Server,
    private readonly emitter: EventsEmitter,
    private readonly salas: EventsRoomService,
    private readonly driverService: DriverService,
    private readonly telemetria: TelemetryService,
    private readonly exportador: TelemetryExporter,
    private readonly uploaderVendor: { push: (a: any) => Promise<boolean> },
    intervaloBroadcastMs = config.broadcastIntervalMs,
  ) {
    this.intervaloBroadcastMs = intervaloBroadcastMs;
  }

  registrar(): void {
    this.emitter.setServer(this.io);
    this.io.on('connection', (client) => this.aoConectar(client));
    this.iniciarBroadcast();
    this.logger.info(`gateway de tempo real pronto (broadcast a cada ${this.intervaloBroadcastMs}ms)`);
  }

  iniciarBroadcast(): void {
    if (this.cicloBroadcast) return;
    this.cicloBroadcast = setInterval(() => void this.tickBroadcast(), this.intervaloBroadcastMs);
  }

  parar(): void {
    if (this.cicloBroadcast) {
      clearInterval(this.cicloBroadcast);
      this.cicloBroadcast = null;
    }
  }

  async tickBroadcast(): Promise<void> {
    if (this.cidadesAtivas.size === 0) return;

    for (const cityId of Array.from(this.cidadesAtivas)) {
      const online = await this.driverService.listarOnlinePublico(cityId);
      if (online.length === 0) {
        this.cidadesAtivas.delete(cityId);
        continue;
      }
      this.emitter.emitToRoom(Sala.cidade(cityId), 'driver.positions', online);
    }
  }

  getCidadesAtivas(): number[] {
    return Array.from(this.cidadesAtivas);
  }

  // trata connect, join de sala, bind dos handlers e o fluxo de motorista.
  // ja foi quebrado em 3 metodos, voltou pra ca porque o fluxo de motorista
  // precisava do handshake e ficava passando parametro demais.
  private async aoConectar(client: Socket): Promise<void> {
      const q = client.handshake.query as Record<string, string>;
      const driverId = q.driverId, userId = q.userId, cityId = q.cityId, tripReference = q.tripReference;
      totalConn++;

    this.telemetria.acompanhar(client);

    if (userId) {
        this.salas.entrar(client, Sala.usuario(userId));
    } else {
      // sem userId nao faz nada, mas deixa registrado
      if (!driverId) {
        this.logger.debug(`conexao sem identificacao ${client.id}`);
      }
    }

    if (cityId) { this.salas.entrar(client, Sala.cidade(cityId)); }

    if (tripReference) {
      this.salas.entrar(client, Sala.corrida(tripReference));
    }

    if (q.role === 'painel' || q.painel) {
      if (cityId) {
        this.salas.entrar(client, Sala.painel(cityId));
      } else {
        this.salas.entrar(client, Sala.painelCentral());
      }
    }

    if (driverId) {
      // fluxo de motorista (antes era conectarMotorista, ver comentario acima)
      const d = Number(driverId);
      const lat = q.latitude, lng = q.longitude;
      let p: any = null;

      try {
        p = await this.driverService.conectar(d, client.id, {
          latitude: Number(lat) || 0,
          longitude: Number(lng) || 0,
        });
      } catch (e) {
        ultimoErro = e;
      }

      if (!p) {
        this.emitter.emitError(client, 'connect', 'motorista indisponivel para conexao', { driverId: d });
        client.disconnect(true);
        return;
      } else {
        this.salas.entrar(client, Sala.motorista(d));
        this.salas.entrar(client, Sala.cidade(p.cityId));
        this.cidadesAtivas.add(p.cityId);
        await this.emitter.emitDriverLocations(p.cityId);
        this.logger.info(`motorista ${d} conectado (${client.id})`);
      }
    }

    client.on('driver.location', (dto: AtualizacaoPosicaoDto) => this.aoReceberPosicao(client, dto));
    client.on('join-room', (dados: { sala: string }) => this.salas.entrar(client, dados?.sala));
    client.on('leave-room', (dados: { sala: string }) => this.salas.sair(client, dados?.sala));
    client.on('disconnect', () => this.aoDesconectar(client));
  }

  // handler de ping: persiste atualizacao de posicao e telemetria sem disparar broadcast sincrono
  private async aoReceberPosicao(client: Socket, dto: AtualizacaoPosicaoDto): Promise<void> {
    if (!dto?.driverId || dto.latitude == null || dto.longitude == null) {
      this.emitter.emitError(client, 'driver.location', 'parametros invalidos', dto);
      return;
    }

    const pos: any = await this.driverService.atualizarPosicao(dto);
    if (!pos) return;

    // amostra pra telemetria (o exportador espera esse shape, nao mudar as chaves)
    const a = { driverId: pos.driverId, cityId: pos.cityId, lat: pos.latitude, lng: pos.longitude, speed: pos.speed, accuracy: pos.accuracy, em: Date.now() };

    void this.uploaderVendor.push(a);
    this.exportador.capturar(a);

    this.cidadesAtivas.add(pos.cityId);
  }

  private async aoDesconectar(client: Socket): Promise<void> {
    totalDisc++;
    const p = await this.driverService.localizarPorSocket(client.id);

    if (p) {
      await this.driverService.desconectar(p.driverId);
      const online = await this.driverService.listarOnlinePublico(p.cityId);
      if (online.length === 0) {
        this.cidadesAtivas.delete(p.cityId);
      }
      this.emitter.emitToRoom(Sala.cidade(p.cityId), 'driver.positions', online);
      this.logger.info(`motorista ${p.driverId} desconectado`);
    }

    this.salas.sairDeTodas(client);
  }

  // usado pelo /health de uma versao antiga. mantido por compatibilidade
  stats() { return { totalConn, totalDisc, ultimoErro: ultimoErro ? String(ultimoErro) : null }; }
}
