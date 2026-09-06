import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PainelService } from './painel.service.js';
import type { EventsEmitter } from '../events/events.emitter.js';

describe('PainelService - Correção Issue 3 (Isolamento de city.summary)', () => {
  let roomEvents: Array<{ room: string; event: string; data: any }> = [];
  let globalEvents: Array<{ event: string; data: any }> = [];
  let painelService: PainelService | null = null;

  const mockTrips = [
    { id_trip: 101, city_id: 1, driver_id: 10, fare: 25.5, status: 'completed' },
    { id_trip: 102, city_id: 1, driver_id: 11, fare: 18.0, status: 'in_progress' },
  ];

  const mockEmitter = {
    emitToRoom: (room: string, event: string, data: any) => {
      roomEvents.push({ room, event, data });
    },
    emitEvent: (event: string, data: any) => {
      globalEvents.push({ event, data });
    },
  } as unknown as EventsEmitter;

  const mockQueryFn = async <T = any>(sql: string, params: any[] = []): Promise<T[]> => {
    if (sql.includes('FROM trips')) {
      return mockTrips as unknown as T[];
    }
    return [] as T[];
  };

  afterEach(() => {
    if (painelService) {
      painelService.parar();
      painelService = null;
    }
    roomEvents = [];
    globalEvents = [];
  });

  test('publicar emite city.summary estritamente para salas de painel (painel:cidade e painel:central)', async () => {
    painelService = new PainelService(mockEmitter, mockQueryFn);

    await painelService.publicar(1);

    // Deve ter emitido para as duas salas de painel
    assert.strictEqual(roomEvents.length, 2);
    assert.strictEqual(roomEvents[0].room, 'painel:1');
    assert.strictEqual(roomEvents[0].event, 'city.summary');
    assert.strictEqual(roomEvents[0].data.corridas.length, 2);

    assert.strictEqual(roomEvents[1].room, 'painel:central');
    assert.strictEqual(roomEvents[1].event, 'city.summary');
    assert.strictEqual(roomEvents[1].data.cityId, 1);

    // CRÍTICO: Nenhum evento global emitEvent deve ter sido disparado (evita vazamento para celulares de motoristas)
    assert.strictEqual(globalEvents.length, 0, 'Não deve emitir city.summary via broadcast global para celulares');
  });

  test('iniciar e parar gerenciam ciclo de publicacao sem vazamento de timers', async () => {
    painelService = new PainelService(mockEmitter, mockQueryFn);

    await painelService.iniciar(1);
    painelService.parar();
    painelService.parar(); // Parada idempotente
  });
});
