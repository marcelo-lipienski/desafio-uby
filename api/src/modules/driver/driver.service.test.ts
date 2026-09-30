import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DriverService } from './driver.service.js';
import { montarPosicao, projetarPosicaoPublica, type MotoristaRow, type MotoristaPosicao } from './driver.types.js';
import type { DriverRepository } from './driver.repository.js';

describe('DriverService & DriverTypes - Correção Issue 2 (Sanitização e Proteção LGPD)', () => {
  const motoristaMockRow: MotoristaRow = {
    id_driver: 42,
    name: 'Carlos Alberto Silva',
    email: 'carlos.silva@provedor.com.br',
    phone: '35988776655',
    cpf: '123.456.789-00',
    city_id: 1,
    category: 'standard',
    status: 'active',
    rating: '4.95',
    total_trips: 1420,
    vehicle_plate: 'ABC1D23',
    vehicle_model: 'Onix',
    vehicle_brand: 'Chevrolet',
    vehicle_color: 'Prata',
    vehicle_year: 2021,
    documents_ok: 1,
    cnh_expires_at: '2028-10-15',
    bank_account: '001 / Agência 1234 / CC 98765-4',
    wallet_balance: '3450.75',
    last_connection: '2026-09-06T10:00:00.000Z',
    created_at: '2023-01-15T08:00:00.000Z',
  };

  test('montarPosicao inclui dados cadastrais e bancários para uso interno', () => {
    const posicao = montarPosicao(
      motoristaMockRow,
      { latitude: -21.3767, longitude: -46.5253, heading: 180, speed: 40, accuracy: 8 },
      'socket-42',
    );

    assert.strictEqual(posicao.driverId, 42);
    assert.strictEqual(posicao.cadastro.cpf, '123.456.789-00');
    assert.strictEqual(posicao.cadastro.bankAccount, '001 / Agência 1234 / CC 98765-4');
    assert.strictEqual(posicao.cadastro.walletBalance, 3450.75);
    assert.strictEqual(posicao.veiculo.plate, 'ABC1D23');
  });

  test('projetarPosicaoPublica remove estritamente todos os dados sensíveis e PII', () => {
    const posicaoCompleta = montarPosicao(
      motoristaMockRow,
      { latitude: -21.3767, longitude: -46.5253, heading: 180, speed: 40, accuracy: 8 },
      'socket-42',
    );

    const publica = projetarPosicaoPublica(posicaoCompleta);

    // Campos públicos necessários presentes
    assert.strictEqual(publica.driverId, 42);
    assert.strictEqual(publica.latitude, -21.3767);
    assert.strictEqual(publica.longitude, -46.5253);
    assert.strictEqual(publica.heading, 180);

    // CRÍTICO: Nenhum campo de cadastro, financeiro ou dados pessoais deve existir no DTO público
    const chaves = Object.keys(publica);
    assert.deepStrictEqual(chaves.sort(), ['driverId', 'heading', 'latitude', 'longitude'].sort());

    const qualquerPublica = publica as any;
    assert.strictEqual(qualquerPublica.cadastro, undefined, 'Não deve conter objeto cadastro');
    assert.strictEqual(qualquerPublica.cpf, undefined, 'Não deve conter CPF');
    assert.strictEqual(qualquerPublica.bankAccount, undefined, 'Não deve conter dados bancários');
    assert.strictEqual(qualquerPublica.walletBalance, undefined, 'Não deve conter saldo de carteira');
    assert.strictEqual(qualquerPublica.email, undefined, 'Não deve conter email');
    assert.strictEqual(qualquerPublica.phone, undefined, 'Não deve conter telefone');
    assert.strictEqual(qualquerPublica.veiculo, undefined, 'Não deve conter dados do veículo');
  });

  test('projetarPosicaoPublica reduz tamanho serializado JSON em mais de 80%', () => {
    const posicaoCompleta = montarPosicao(
      motoristaMockRow,
      { latitude: -21.3767, longitude: -46.5253, heading: 180, speed: 40, accuracy: 8 },
      'socket-42',
    );

    const jsonCompleto = JSON.stringify(posicaoCompleta);
    const jsonPublico = JSON.stringify(projetarPosicaoPublica(posicaoCompleta));

    const bytesCompleto = Buffer.byteLength(jsonCompleto);
    const bytesPublico = Buffer.byteLength(jsonPublico);

    const reducaoPct = ((bytesCompleto - bytesPublico) / bytesCompleto) * 100;

    assert.ok(
      reducaoPct > 80,
      `Redução esperada de mais de 80%, obtida: ${reducaoPct.toFixed(1)}% (${bytesCompleto}B -> ${bytesPublico}B)`,
    );
  });

  test('DriverService.listarOnlinePublico retorna apenas DTOs sanitizados', async () => {
    const mockRepo = {
      listarOnline: async (_cityId: number) => {
        return [
          montarPosicao(motoristaMockRow, { latitude: -21.37, longitude: -46.52, heading: 90 }, 's1'),
          montarPosicao({ ...motoristaMockRow, id_driver: 43 }, { latitude: -21.38, longitude: -46.53, heading: 120 }, 's2'),
        ];
      },
    } as unknown as DriverRepository;

    const service = new DriverService(mockRepo);
    const online = await service.listarOnlinePublico(1);

    assert.strictEqual(online.length, 2);
    for (const d of online) {
      assert.strictEqual(typeof d.driverId, 'number');
      assert.strictEqual(typeof d.latitude, 'number');
      assert.strictEqual(typeof d.longitude, 'number');
      assert.strictEqual(typeof d.heading, 'number');
      assert.strictEqual((d as any).cadastro, undefined);
      assert.strictEqual((d as any).veiculo, undefined);
    }
  });

  test('projetarPosicaoPublica rejeita e lança erro para coordenadas ou driverId ausentes ou inválidos', () => {
    assert.throws(
      () => projetarPosicaoPublica({ driverId: 1, latitude: null as any, longitude: -46.52 }),
      /latitude inválida/,
    );
    assert.throws(
      () => projetarPosicaoPublica({ driverId: 1, latitude: 95, longitude: -46.52 }),
      /latitude inválida/,
    );
    assert.throws(
      () => projetarPosicaoPublica({ driverId: 1, latitude: -21.37, longitude: -200 }),
      /longitude inválida/,
    );
    assert.throws(
      () => projetarPosicaoPublica({ driverId: null as any, latitude: -21.37, longitude: -46.52 }),
      /driverId inválido/,
    );
  });

  test('DriverService.listarOnlinePublico descarta posições anômalas sem virar zero em silêncio', async () => {
    const mockRepo = {
      listarOnline: async (_cityId: number) => {
        return [
          montarPosicao(motoristaMockRow, { latitude: -21.37, longitude: -46.52, heading: 90 }, 's1'),
          // Posição corrompida (latitude nula)
          { ...montarPosicao({ ...motoristaMockRow, id_driver: 99 }, { latitude: 0, longitude: 0 }, 's2'), latitude: null as any },
        ];
      },
    } as unknown as DriverRepository;

    const service = new DriverService(mockRepo);
    const online = await service.listarOnlinePublico(1);

    assert.strictEqual(online.length, 1, 'Deve descartar o registro com latitude nula');
    assert.strictEqual(online[0].driverId, 42);
  });
});
