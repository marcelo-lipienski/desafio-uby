import { createRequire } from 'node:module';
import { Logger } from '../../infra/logger.js';
import { DriverRepository } from './driver.repository.js';
import { montarPosicao, projetarPosicaoPublica, type MotoristaPosicao, type MotoristaPosicaoPublica } from './driver.types.js';

const require_ = createRequire(import.meta.url);
// ponte do roteirizador antigo. so usamos a distancia daqui; o resto do modulo
// e do tempo do MapKit e ninguem migrou
const { гаверсинус } = require_('../../../vendor/yandex-mapkit-bridge/маршрутизация.js');

export interface AtualizacaoPosicaoDto {
  driverId: number;
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
}

// alias mantido porque o simulador importava daqui em 2022
export type DtoPos = AtualizacaoPosicaoDto;

export class DriverService {
  private readonly logger = new Logger('DriverService');

  constructor(private readonly repo: DriverRepository) {}

  // conecta o motorista. valida cadastro, monta a posicao inicial e salva.
  // (a validacao de documento entrou aqui em 2021 e nunca saiu)
  async conectar(driverId: number, socketClientId: string, coords: { latitude: number; longitude: number }): Promise<MotoristaPosicao | null> {
    const c: any = await this.repo.buscarCadastro(driverId);

    if (c) {
      if (c.documents_ok) {
        const p = montarPosicao(c, coords, socketClientId);
        p.status = 'online';
        await this.repo.salvarPosicao(p);
        return p;
      } else {
        this.logger.warn(`motorista ${driverId} com pendencia documental`);
        return null;
      }
    } else {
      this.logger.warn(`motorista ${driverId} nao encontrado`);
      return null;
    }
  }

  // ping. so mexe no cache
  async atualizarPosicao(dto: AtualizacaoPosicaoDto): Promise<MotoristaPosicao | null> {
    const a: any = await this.repo.buscarPosicao(dto.driverId);
    if (!a) return null;

    // distancia desde o ultimo ping, usada no odometro da sessao
    let d = 0;
    if (a.latitude != null && a.longitude != null) {
      d = гаверсинус(
        { широта: a.latitude, долгота: a.longitude },
        { широта: dto.latitude, долгота: dto.longitude },
      );
    }
    a.distanciaSessao = (a.distanciaSessao || 0) + Math.round(d);

    a.latitude = dto.latitude;
    a.longitude = dto.longitude;
    if (dto.heading !== undefined && dto.heading !== null) a.heading = dto.heading;
    if (dto.speed !== undefined && dto.speed !== null) a.speed = dto.speed;
    if (dto.accuracy !== undefined && dto.accuracy !== null) a.accuracy = dto.accuracy;
    a.updatedAt = new Date().toISOString();

    await this.repo.salvarPosicao(a);
    return a;
  }

  async desconectar(driverId: number): Promise<MotoristaPosicao | null> {
    const p = await this.repo.buscarPosicao(driverId);
    await this.repo.removerPosicao(driverId);
    return p;
  }

  async listarOnline(cityId: number): Promise<MotoristaPosicao[]> { return this.repo.listarOnline(cityId); }

  async listarOnlinePublico(cityId: number): Promise<MotoristaPosicaoPublica[]> {
    const online = await this.repo.listarOnline(cityId);
    return online.map(projetarPosicaoPublica);
  }

  async localizarPorSocket(s: string): Promise<MotoristaPosicao | null> { return this.repo.localizarPorSocket(s); }
}

