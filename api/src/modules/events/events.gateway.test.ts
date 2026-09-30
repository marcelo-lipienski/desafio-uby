import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventsGateway } from './events.gateway.js';
import type { Server, Socket } from 'socket.io';
import type { EventsEmitter } from './events.emitter.js';
import type { EventsRoomService } from './events.rooms.js';
import type { DriverService, AtualizacaoPosicaoDto } from '../driver/driver.service.js';
import type { TelemetryService } from '../telemetry/telemetry.service.js';
import type { TelemetryExporter } from '../telemetry/telemetry.exporter.js';

describe('EventsGateway - Correção Issue 1 (Broadcast Desacoplado)', () => {
  let emittedEvents: Array<{ event: string; data: any; room?: string }> = [];
  let clientErrors: Array<{ event: string; payload: any }> = [];
  let telemetryPushed: any[] = [];
  let telemetryExported: any[] = [];
  let positionUpdates: AtualizacaoPosicaoDto[] = [];
  let onlineDriversByCity: Record<number, any[]> = {};
  let socketEventHandlers: Record<string, Function> = {};
  let socketClient: any;
  let serverConnHandler: ((client: Socket) => Promise<void> | void) | null = null;
  let gateway: EventsGateway;

  beforeEach(() => {
    emittedEvents = [];
    clientErrors = [];
    telemetryPushed = [];
    telemetryExported = [];
    positionUpdates = [];
    socketEventHandlers = {};
    onlineDriversByCity = {
      1: [
        { driverId: 10, cityId: 1, latitude: -21.37, longitude: -46.52, heading: 90 },
        { driverId: 11, cityId: 1, latitude: -21.38, longitude: -46.53, heading: 180 },
      ],
    };

    socketClient = {
      id: 'socket-test-123',
      handshake: {
        query: { driverId: '10', latitude: '-21.37', longitude: '-46.52' },
      },
      rooms: new Set(['socket-test-123']),
      emit: (event: string, payload: any) => {
        clientErrors.push({ event, payload });
      },
      on: (event: string, handler: Function) => {
        socketEventHandlers[event] = handler;
      },
      disconnect: (_force?: boolean) => {},
      join: (_room: string) => {},
      leave: (_room: string) => {},
    };

    const mockIo = {
      on: (event: string, handler: any) => {
        if (event === 'connection') serverConnHandler = handler;
      },
      emit: (event: string, data: any) => {
        emittedEvents.push({ event, data });
      },
    } as unknown as Server;

    const mockEmitter = {
      setServer: () => {},
      emitEvent: (event: string, data: any) => {
        emittedEvents.push({ event, data });
      },
      emitToRoom: (room: string, event: string, data: any) => {
        emittedEvents.push({ event, data, room });
      },
      emitDriverLocations: async (cityId: number) => {
        const drivers = onlineDriversByCity[cityId] || [];
        emittedEvents.push({ event: 'driver.positions', data: drivers, room: `city:${cityId}` });
      },
      emitError: (_client: any, eventEmitted: string, message: string, data?: any) => {
        clientErrors.push({ event: 'error', payload: { eventEmitted, message, data } });
      },
    } as unknown as EventsEmitter;

    const mockSalas = {
      entrar: (client: any, sala: string) => {
        client.rooms.add(sala);
      },
      sair: (client: any, sala: string) => {
        client.rooms.delete(sala);
      },
      sairDeTodas: (client: any) => {
        client.rooms.clear();
      },
    } as unknown as EventsRoomService;

    const mockDriverService = {
      conectar: async (driverId: number, _socketId: string, coords: any) => {
        return {
          driverId,
          cityId: 1,
          latitude: coords.latitude,
          longitude: coords.longitude,
        };
      },
      atualizarPosicao: async (dto: AtualizacaoPosicaoDto) => {
        positionUpdates.push(dto);
        const cityId = dto.driverId >= 20 ? 2 : 1;
        return {
          driverId: dto.driverId,
          cityId,
          latitude: dto.latitude,
          longitude: dto.longitude,
          speed: dto.speed ?? 30,
          accuracy: dto.accuracy ?? 10,
        };
      },
      desconectar: async (driverId: number) => {
        onlineDriversByCity[1] = (onlineDriversByCity[1] || []).filter((d) => d.driverId !== driverId);
        return { driverId, cityId: 1 };
      },
      listarOnline: async (cityId: number) => {
        return onlineDriversByCity[cityId] || [];
      },
      listarOnlinePublico: async (cityId: number) => {
        const drivers = onlineDriversByCity[cityId] || [];
        return drivers.map((d) => ({
          driverId: d.driverId,
          latitude: d.latitude,
          longitude: d.longitude,
          heading: d.heading,
        }));
      },
      localizarPorSocket: async (_socketId: string) => {
        return { driverId: 10, cityId: 1 };
      },
    } as unknown as DriverService;

    const mockTelemetryService = {
      acompanhar: () => {},
    } as unknown as TelemetryService;

    const mockTelemetryExporter = {
      capturar: (amostra: any) => {
        telemetryExported.push(amostra);
      },
    } as unknown as TelemetryExporter;

    const mockUploaderVendor = {
      push: async (amostra: any) => {
        telemetryPushed.push(amostra);
        return true;
      },
    };

    gateway = new EventsGateway(
      mockIo,
      mockEmitter,
      mockSalas,
      mockDriverService,
      mockTelemetryService,
      mockTelemetryExporter,
      mockUploaderVendor,
      10000, // Intervalo longo para que os ticks só rodem sob comando nos testes
    );
  });

  afterEach(() => {
    gateway.parar();
  });

  test('não dispara driver.positions no handler de ping (desacoplamento O(N^2))', async () => {
    gateway.registrar();
    assert.ok(serverConnHandler);
    await serverConnHandler(socketClient);

    // Limpa os eventos de conexão inicial
    emittedEvents = [];

    // Simula 30 pings consecutivos de motoristas
    for (let i = 0; i < 30; i++) {
      await socketEventHandlers['driver.location']({
        driverId: 10,
        latitude: -21.376 + i * 0.0001,
        longitude: -46.525 + i * 0.0001,
        heading: 90,
      });
    }

    // 30 atualizações processadas
    assert.strictEqual(positionUpdates.length, 30);
    assert.strictEqual(telemetryExported.length, 30);
    assert.strictEqual(telemetryPushed.length, 30);

    // CRÍTICO: Nenhum broadcast de driver.positions deve ter sido disparado síncronamente durante os pings
    const positionBroadcasts = emittedEvents.filter((e) => e.event === 'driver.positions');
    assert.strictEqual(positionBroadcasts.length, 0, 'Não deve emitir driver.positions durante o ping de localização');
  });

  test('tickBroadcast emite posições consolidadas para as cidades ativas', async () => {
    gateway.registrar();
    assert.ok(serverConnHandler);
    await serverConnHandler(socketClient);
    emittedEvents = [];

    // Recebe ping para marcar a cidade como ativa
    await socketEventHandlers['driver.location']({
      driverId: 10,
      latitude: -21.376,
      longitude: -46.525,
      heading: 90,
    });

    assert.deepStrictEqual(gateway.getCidadesAtivas(), [1]);

    // Executa o tick do broadcast periódico
    await gateway.tickBroadcast();

    const positionBroadcasts = emittedEvents.filter((e) => e.event === 'driver.positions');
    assert.strictEqual(positionBroadcasts.length, 1, 'Deve emitir exatamente 1 broadcast por tick');
    assert.strictEqual(positionBroadcasts[0].room, 'city:1', 'Deve direcionar estritamente para a sala da cidade');
    assert.strictEqual(positionBroadcasts[0].data.length, 2);
  });

  test('tickBroadcast isola emissões entre múltiplas cidades sem cruzamento', async () => {
    onlineDriversByCity = {
      1: [{ driverId: 10, cityId: 1, latitude: -21.37, longitude: -46.52, heading: 90 }],
      2: [{ driverId: 20, cityId: 2, latitude: -21.30, longitude: -46.71, heading: 180 }],
    };

    gateway.registrar();
    assert.ok(serverConnHandler);
    await serverConnHandler(socketClient); // Ativa cidade 1

    // Simula ping na cidade 2
    await socketEventHandlers['driver.location']({
      driverId: 20,
      latitude: -21.30,
      longitude: -46.71,
      heading: 180,
    });

    emittedEvents = [];
    await gateway.tickBroadcast();

    const broadcasts = emittedEvents.filter((e) => e.event === 'driver.positions');
    assert.strictEqual(broadcasts.length, 2, 'Deve emitir 1 broadcast para cada cidade ativa');

    const broadCity1 = broadcasts.find((b) => b.room === 'city:1');
    const broadCity2 = broadcasts.find((b) => b.room === 'city:2');

    assert.ok(broadCity1, 'Deve emitir para a sala city:1');
    assert.ok(broadCity2, 'Deve emitir para a sala city:2');
    assert.strictEqual(broadCity1.data[0].driverId, 10, 'Sala da cidade 1 deve conter apenas motoristas da cidade 1');
    assert.strictEqual(broadCity2.data[0].driverId, 20, 'Sala da cidade 2 deve conter apenas motoristas da cidade 2');
  });

  test('painel municipal entra exclusivamente em painel:cidade sem duplicar com painel:central', async () => {
    gateway.registrar();
    assert.ok(serverConnHandler);

    const painelMunicipalSocket = {
      id: 'painel-muzambinho',
      handshake: { query: { role: 'painel', cityId: '1' } },
      rooms: new Set<string>(['painel-muzambinho']),
      emit: () => {},
      on: () => {},
      disconnect: () => {},
      join: (r: string) => painelMunicipalSocket.rooms.add(r),
      leave: (r: string) => painelMunicipalSocket.rooms.delete(r),
    };

    await serverConnHandler(painelMunicipalSocket as any);

    assert.ok(painelMunicipalSocket.rooms.has('painel:1'), 'Painel municipal deve entrar na sala da sua cidade');
    assert.ok(!painelMunicipalSocket.rooms.has('painel:central'), 'Painel municipal NÃO deve entrar em painel:central');

    const painelCentralSocket = {
      id: 'painel-central-geral',
      handshake: { query: { role: 'painel' } },
      rooms: new Set<string>(['painel-central-geral']),
      emit: () => {},
      on: () => {},
      disconnect: () => {},
      join: (r: string) => painelCentralSocket.rooms.add(r),
      leave: (r: string) => painelCentralSocket.rooms.delete(r),
    };

    await serverConnHandler(painelCentralSocket as any);
    assert.ok(painelCentralSocket.rooms.has('painel:central'), 'Painel geral deve entrar em painel:central');
    assert.ok(!painelCentralSocket.rooms.has('painel:1'), 'Painel geral não deve entrar em sala municipal específica');
  });

  test('remove cidade de cidadesAtivas quando não houver mais motoristas online', async () => {
    gateway.registrar();
    assert.ok(serverConnHandler);
    await serverConnHandler(socketClient);
    emittedEvents = [];

    // Esvazia os motoristas online da cidade 1
    onlineDriversByCity[1] = [];

    await gateway.tickBroadcast();

    // A cidade deve ter sido removida da lista de cidades ativas e nenhum broadcast emitido
    assert.strictEqual(gateway.getCidadesAtivas().length, 0);
    const positionBroadcasts = emittedEvents.filter((e) => e.event === 'driver.positions');
    assert.strictEqual(positionBroadcasts.length, 0);
  });

  test('valida parâmetros do ping e rejeita coordenadas inválidas', async () => {
    gateway.registrar();
    assert.ok(serverConnHandler);
    await serverConnHandler(socketClient);

    await socketEventHandlers['driver.location']({
      driverId: 10,
      latitude: null,
      longitude: -46.525,
    });

    assert.strictEqual(positionUpdates.length, 0);
    const erros = clientErrors.filter((e) => e.event === 'error');
    assert.strictEqual(erros.length, 1);
    assert.strictEqual(erros[0].payload.eventEmitted, 'driver.location');
  });

  test('iniciarBroadcast e parar gerenciam o timer sem vazamento de recursos', () => {
    gateway.iniciarBroadcast();
    gateway.iniciarBroadcast(); // Segunda chamada não deve criar timer duplicado
    gateway.parar();
    gateway.parar(); // Segunda parada idempotente
  });
});
