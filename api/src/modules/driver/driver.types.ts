/** Linha de `drivers` como vem do banco. */
export interface MotoristaRow {
  id_driver: number;
  name: string;
  email: string;
  phone: string;
  cpf: string;
  city_id: number;
  category: string;
  status: string;
  rating: string | number;
  total_trips: number;
  vehicle_plate: string;
  vehicle_model: string;
  vehicle_brand: string;
  vehicle_color: string;
  vehicle_year: number;
  documents_ok: number;
  cnh_expires_at: string | null;
  bank_account: string | null;
  wallet_balance: string | number;
  last_connection: string | null;
  created_at: string;
}

/**
 * Registro que fica no cache de posicao.
 * Guardamos o cadastro junto para o app do passageiro conseguir montar o card
 * do motorista sem uma segunda ida ao banco.
 */
export interface MotoristaPosicao {
  driverId: number;
  cityId: number;
  latitude: number;
  longitude: number;
  heading: number;
  speed: number;
  status: string;
  accuracy: number;
  socketClientId: string;
  lastConnection: string;
  updatedAt: string;
  cadastro: {
    name: string;
    email: string;
    phone: string;
    cpf: string;
    category: string;
    rating: number;
    totalTrips: number;
    documentsOk: boolean;
    cnhExpiresAt: string | null;
    bankAccount: string | null;
    walletBalance: number;
    createdAt: string;
  };
  veiculo: {
    plate: string;
    model: string;
    brand: string;
    color: string;
    year: number;
  };
}

export function montarPosicao(
  row: MotoristaRow,
  pos: { latitude: number; longitude: number; heading?: number; speed?: number; accuracy?: number },
  socketClientId: string,
): MotoristaPosicao {
  const agora = new Date().toISOString();

  return {
    driverId: row.id_driver,
    cityId: row.city_id,
    latitude: pos.latitude,
    longitude: pos.longitude,
    heading: pos.heading ?? 0,
    speed: pos.speed ?? 0,
    status: row.status,
    accuracy: pos.accuracy ?? 12,
    socketClientId,
    lastConnection: row.last_connection ?? agora,
    updatedAt: agora,
    cadastro: {
      name: row.name,
      email: row.email,
      phone: row.phone,
      cpf: row.cpf,
      category: row.category,
      rating: Number(row.rating),
      totalTrips: row.total_trips,
      documentsOk: Boolean(row.documents_ok),
      cnhExpiresAt: row.cnh_expires_at,
      bankAccount: row.bank_account,
      walletBalance: Number(row.wallet_balance),
      createdAt: row.created_at,
    },
    veiculo: {
      plate: row.vehicle_plate,
      model: row.vehicle_model,
      brand: row.vehicle_brand,
      color: row.vehicle_color,
      year: row.vehicle_year,
    },
  };
}

/**
 * DTO público enxuto para difusão em tempo real via WebSocket.
 * Contém estritamente os campos necessários para renderização visual do mapa,
 * eliminando dados cadastrais sensíveis (CPF, conta bancária, telefone, e-mail)
 * em conformidade com a LGPD e reduzindo o consumo de dados móveis em ~90%.
 */
export interface MotoristaPosicaoPublica {
  driverId: number;
  latitude: number;
  longitude: number;
  heading: number;
}

export function projetarPosicaoPublica(pos: Partial<MotoristaPosicao>): MotoristaPosicaoPublica {
  if (pos.driverId == null || !Number.isFinite(pos.driverId)) {
    throw new Error('driverId inválido ou ausente para projeção de posição pública');
  }
  if (pos.latitude == null || !Number.isFinite(pos.latitude) || pos.latitude < -90 || pos.latitude > 90) {
    throw new Error(`latitude inválida (${pos.latitude}) para o motorista ${pos.driverId}`);
  }
  if (pos.longitude == null || !Number.isFinite(pos.longitude) || pos.longitude < -180 || pos.longitude > 180) {
    throw new Error(`longitude inválida (${pos.longitude}) para o motorista ${pos.driverId}`);
  }

  return {
    driverId: pos.driverId,
    latitude: pos.latitude,
    longitude: pos.longitude,
    heading: Number.isFinite(pos.heading) ? Number(pos.heading) : 0,
  };
}

