# Relatório Técnico e de Negócio: Diagnóstico de Consumo Crítico de Dados Móveis e Egress de Infraestrutura

**Referência:** Chamado #4471 — Suporte / Financeiro (Prioridade Alta)  
**Data:** 06 de Setembro de 2026  
**Contexto:** Queixa de motoristas parceiros de Muzambinho sobre o esgotamento instantâneo de franquias 4G/3G e alerta da equipe financeira relativo ao salto exponencial nos custos de transferência de dados (*egress*) na nuvem.

---

## 1. Sumário Executivo

A investigação detalhada do ecossistema da aplicação (API Node.js/Socket.IO, simulador de frota e bancada do aplicativo do motorista) identificou a causa raiz do problema: **um padrão de comunicação reativo e síncrono que gera uma tempestade de pacotes de complexidade $O(N^2)$, combinada a um *overfetching* severo de dados sensíveis cadastrais e bancários**.

O aplicativo do motorista não consome dados por tráfego legítimo de navegação, mas sim porque o servidor WebSocket retransmite a lista completa de todos os motoristas cadastrados na cidade para **todos** os aparelhos conectados a cada ping individual de localização recebido.

Além do dreno imediato de planos móveis de 20 GB em minutos, a plataforma expõe uma **vulnerabilidade crítica de privacidade (LGPD)** ao transmitir CPFs e dados bancários abertos via broadcast para qualquer cliente conectado.

---

## 2. Matriz de Priorização e Impacto Geral

| # | Causa Identificada | Probabilidade | Impacto Atual | Impacto a 10x | Impacto a 100x | Complexidade Técnica | Complexidade de Negócio |
|---|---|---|---|---|---|---|---|
| **1** | **Broadcast Global Reativo $O(N^2)$ a cada Ping (`driver.positions`)** | **100% (Certa)** | **Crítico** | **Catastrófico (Queda)** | **Inviável (Colapso)** | Baixa | Baixa |
| **2** | **Overfetching de Payload e Vazamento de Dados Sensíveis (LGPD)** | **100% (Certa)** | **Crítico** | **Crítico** | **Crítico** | Muito Baixa | Baixa |
| **3** | **Vazamento de Eventos de Back-office (`city.summary`) para Celulares** | **100% (Certa)** | **Médio-Alto** | **Alto** | **Crítico** | Muito Baixa | Nula |
| **4** | **Ausência de Escopo Espacial / Filtro de Proximidade (Geofence)** | **Alta** | **Médio** | **Alto** | **Catastrófico** | Média | Baixa |
| **5** | **Sobrecarga de HTTP Long-Polling em Enlaces 3G/Oscilantes** | **Média** | **Médio** | **Médio** | **Alto** | Média | Baixa |
| **6** | **Pings Rígidos por Tempo Sem Adaptação a Veículo Parado** | **Média** | **Baixo-Médio**| **Médio** | **Alto** | Baixa | Baixa |

---

## 3. Análise Detalhada dos Problemas Identificados

---

### Problema 1: Broadcast Global Reativo $O(N^2)$ a cada Ping de Posição

#### Evidência Técnica no Código
- **Arquivo:** [`api/src/modules/events/events.gateway.ts`](/api/src/modules/events/events.gateway.ts#L92-L109)
  ```typescript
  private async aoReceberPosicao(client: Socket, dto: AtualizacaoPosicaoDto): Promise<void> {
    const pos = await this.driverService.atualizarPosicao(dto);
    // ...
    const tmp = await this.driverService.listarOnline(pos.cityId);
    this.emitter.emitEvent('driver.positions', tmp);
  }
  ```
- **Arquivo:** [`api/src/modules/events/events.emitter.ts`](/api/src/modules/events/events.emitter.ts#L28-L35)
  ```typescript
  emitEvent(event: string, data: any) {
    this.server.emit(event, data); // Disparo global para TODOS os sockets da API
  }
  ```

#### Análise de Impacto Técnico e de Negócio
- **Técnico:** Para $N$ motoristas emitindo 1 ping a cada 1–2 segundos, o servidor recebe $N$ pings/s. A cada ping recebido, o servidor dispara um evento para todos os $N$ clientes. O número de mensagens trafegadas na rede cresce quadraticamente:
  $$\text{Mensagens por segundo} = N \times N = N^2$$
  Em uma frota de apenas 30 motoristas, cada aparelho de motorista recebe **30 listas completas por segundo** via WebSocket!
- **Negócio:** 
  - O motorista esgota o pacote de dados mensal em menos de 2 horas de turno diário.
  - A conta de *egress* de rede da nuvem escala em proporção quadrática, gerando a anomalia financeira apontada pelo financeiro.
  - Degradação de bateria e aquecimento severo nos aparelhos dos motoristas devido ao processamento ininterrupto de dezenas de frames de rede por segundo.

#### Projeção de Escala

| Cenário | Qtd. Motoristas ($N$) | Pings Ingestão / s | Msg Broadcast / s | Volume Download / Celular | Egress Servidor / Mês | Custo Nuvem Egress (Est. AWS) |
|---|---|---|---|---|---|---|
| **Base Atual** | 30 | 30 / s | 900 / s | **~585 KB/s (35 MB/min)** | **~45,3 TB / mês** | **~US$ 3.624 / mês** |
| **Escala 10x** | 300 | 300 / s | 90.000 / s | **~58,5 MB/s (468 Mbps!)** | **~45,3 PB / mês** | **~US$ 3,6 Milhões / mês** |
| **Escala 100x** | 3.000 | 3.000 / s | 9.000.000 / s | *Colapso de banda móvel* | *Inviável* | *Falência operacional* |

*Nota sobre 10x e 100x:* A 10x, nenhum smartphone 4G consegue receber 468 Mbps de JSON; o aplicativo congela por falta de memória (OOM), as conexões TCP são derrubadas por saturação de buffer e a API Node.js trava seu Event Loop em serializações contínuas de JSON.

#### Abordagem de Correção Recomendada
1. **Desacoplar Ingestão de Difusão (World Tick):** 
   O recebimento de `driver.location` deve apenas persistir a coordenada em cache (Redis). Nenhuma difusão deve ocorrer dentro do *handler* do ping.
2. **Ciclo de Atualização com Taxa Fixa (ex: 3 a 5 segundos):**
   Um *worker* ou temporizador no servidor coleta as posições consolidadas e despacha uma única atualização agrupada em intervalo constante (ex: a cada 3s).
3. **Complexidade Técnica:** Baixa (refatoração de ~15 linhas em `events.gateway.ts`).
4. **Complexidade de Negócio:** Baixa (transparente para as operações e motoristas).
5. **Impacto Positivo:** Redução imediata de **95% a 99%** no volume de pacotes e no consumo de dados.
6. **Prós vs. Contras:**
   - *Pró:* Estabilidade de banda linear $O(N)$ em vez de $O(N^2)$, previsibilidade de custos.
   - *Contra:* A posição dos outros motoristas terá uma latência de visualização de 1 a 3 segundos no mapa.
   - *Por que o Pró supera o Contra:* A representação de outros carros na tela é meramente ilustrativa e de contexto; uma latência de 2 a 3 segundos com interpolação visual local não afeta a dirigibilidade nem a segurança da corrida.

---

### Problema 2: Overfetching de Payload e Vazamento Crítico de Dados Sensíveis (LGPD)

#### Evidência Técnica no Código
- **Arquivo:** [`api/src/modules/driver/driver.types.ts`](/api/src/modules/driver/driver.types.ts#L31-L64)
- **Arquivo:** [`web/public/js/mapa.js`](/web/public/js/mapa.js#L127-L135)
  O objeto transmitido `MotoristaPosicao` contém:
  - `cadastro.cpf`, `cadastro.email`, `cadastro.phone`, `cadastro.bankAccount`, `cadastro.walletBalance`, `cadastro.cnhExpiresAt`.
  - `veiculo.plate`, `veiculo.model`, `veiculo.color`.
  
  Enquanto o cliente Web/App (`mapa.js`) utiliza **exclusivamente**:
  ```javascript
  o.driverId, o.latitude, o.longitude, o.heading
  ```

#### Análise de Impacto Técnico e de Negócio
- **Técnico:** Cada motorista na lista pesa entre **650 e 850 bytes** em JSON. Para 30 motoristas, a lista transmitida tem ~20 KB por pacote. Se apenas os 4 campos necessários fossem enviados, o registro por motorista cairia para **25 bytes** (redução de 96% no peso da mensagem).
- **Negócio e Jurídico (Gravidade Extrema):**
  - **Violação da LGPD (Lei 13.709/2018):** Exposição massiva e injustificada de Dados Pessoais e Dados Bancários de todos os motoristas cadastrados para qualquer cliente que abrir um WebSocket.
  - Risco de autuações da ANPD (multas de até 2% do faturamento, limitadas a R$ 50 milhões por infração).
  - Risco de processos trabalhistas coletivos e perda irreparável de reputação da plataforma.

#### Projeção de Escala

| Cenário | Qtd. Motoristas | Tamanho Payload Atual (JSON com CPF/Banco) | Tamanho Payload Corrigido (DTO Compacto) | Economia Direta de Payload |
|---|---|---|---|---|
| **Base Atual** | 30 | ~21 KB / mensagem | ~0,8 KB / mensagem | **96,2%** |
| **Escala 10x** | 300 | ~210 KB / mensagem | ~7,5 KB / mensagem | **96,4%** |
| **Escala 100x** | 3.000 | ~2,1 MB / mensagem | ~75 KB / mensagem | **96,4%** |

#### Abordagem de Correção Recomendada
1. **Implementar DTO de Projeção Pública de Telemetria:**
   Criar um formato restrito para transmissão em tempo real:
   ```typescript
   export interface PosicaoPublicaDto {
     id: number;
     lat: number;
     lng: number;
     h: number;
   }
   ```
   *(Ou no formato de tupla compacta: `[id, lat, lng, heading]`)*.
2. **Complexidade Técnica:** Muito Baixa (criação de método de mapeamento `.map()` antes do envio).
3. **Complexidade de Negócio:** Baixa (necessário apenas garantir que o app do passageiro obtenha o perfil completo via requisição HTTP autenticada quando uma corrida for aceita, e não via stream aberto).
4. **Impacto Positivo:** Elimina o risco de passivo jurídico da LGPD e reduz o consumo de dados em 96%.
5. **Prós vs. Contras:**
   - *Pró:* Conformidade legal imediata, payload ultraleve, redução drástica de processamento em dispositivos de entrada.
   - *Contra:* Dados cadastrais não estarão mais "à mão" no cache do socket caso alguma tela antiga dependesse disso.
   - *Por que o Pró supera o Contra:* Dados bancários e documentos jamais deveriam trafegar em canais de broadcast em tempo real.

---

### Problema 3: Vazamento de Eventos de Back-office (`city.summary`) para Celulares

#### Evidência Técnica no Código
- **Arquivo:** [`api/src/modules/painel/painel.service.ts`](/api/src/modules/painel/painel.service.ts#L43-L46)
  ```typescript
  private async publicar(cityId: number) {
    const r = await consultar(`SELECT * FROM trips WHERE city_id = ? ORDER BY created_at DESC LIMIT ?`, [cityId, this.janela]);
    this.emitter.emitEvent('city.summary', { cityId, em: Date.now(), corridas: r });
  }
  ```
  O método `PainelService` dispara a cada 2 segundos uma lista com as **20 últimas corridas do banco** para o canal global (`server.emit`).

#### Análise de Impacto Técnico e de Negócio
- **Técnico:** Os celulares dos motoristas não se registram para ouvir o evento `city.summary`, mas como o Socket.IO opera em broadcast geral sem segmentação de salas, os pacotes trafegam fisicamente pelo canal de rede do celular, que é forçado a descriptografar (TLS), enfileirar e descartar os dados.
- **Negócio:** Desperdício de pacote de dados móveis do motorista em benefício de um recurso que pertence estritamente ao painel operacional da central de despacho.

#### Projeção de Escala
- Em 30 motoristas: ~10 KB a cada 2 segundos por motorista = **300 KB/minuto jogados no lixo por aparelho**.
- A 100x (3.000 motoristas): Representa dezenas de megabits por segundo de tráfego inútil para a base móvel.

#### Abordagem de Correção Recomendada
- Utilizar a infraestrutura de salas existente em [`EventsRoomService`](file:///home/catz/dev/desafio-uby/api/src/modules/events/events.rooms.ts):
  Substituir `this.server.emit('city.summary', ...)` por:
  ```typescript
  this.server.to('painel:central').emit('city.summary', ...);
  ```
  Apenas navegadores autorizados da equipe de operações entram na sala `painel:central`.
- **Complexidade Técnica:** Muito Baixa (1 linha de código).
- **Complexidade de Negócio:** Nula.
- **Impacto Positivo:** Desoneração total dos dispositivos móveis desse fluxo de dados.

---

### Problema 4: Ausência de Escopo Espacial e Filtro de Viewport Geográfico

#### Evidência Técnica no Código
- Não há particionamento por cidade nem cálculo de raio de visão.
- O motorista de Muzambinho recebe dados de veículos que operam em bairros distantes ou até em outras cidades se a instância for compartilhada.
- No frontend ([`mapa.js#L132`](/web/public/js/mapa.js#L132)), o aplicativo descarta carros fora do visor:
  ```javascript
  if (p.x < -20 || p.x > largura + 20 || p.y < -20 || p.y > altura + 20) continue;
  ```

#### Análise de Impacto Técnico e de Negócio
- **Técnico:** Desperdício de largura de banda transmitindo informações de veículos que o motorista nunca verá na tela.
- **Negócio:** O motorista só precisa de percepção espacial do seu entorno imediato (raio de 1 a 2 km) ou, quando em corrida, apenas da sua rota de navegação.

#### Projeção de Escala
- **Base Atual (30 motoristas):** Impacto moderado (a cidade é pequena).
- **Escala 10x (300 motoristas):** Alto. Uma cidade de médio porte tem dezenas de bairros; o motorista da Zona Sul não precisa saber da posição do motorista da Zona Norte.
- **Escala 100x (3.000 motoristas):** Crítico. Transmitir 3.000 posições para cada celular inviabiliza a malha.

#### Abordagem de Correção Recomendada
1. **Segmentação por Células Espaciais (Geohash ou Uber H3):**
   O aplicativo móvel subscreve apenas na sala correspondente à sua célula geográfica atual (ex: raio de 1,5 km). O servidor apenas despacha posições para os clientes inscritos naquela mesma célula ou nas adjacentes.
2. **Complexidade Técnica:** Média (exige indexação por Geohash no Redis com `GEOADD` / `GEORADIUS`).
3. **Complexidade de Negócio:** Baixa.
4. **Impacto Positivo:** O tráfego por aparelho deixa de crescer com o tamanho total da frota e passa a ter um teto fixo (número máximo de carros vizinhos visíveis, tipicamente 5 a 10).

---

### Problema 5: Sobrecarga de HTTP Long-Polling em Enlaces Celulares 3G/Instáveis

#### Evidência Técnica no Código
- **Arquivo:** [`web/public/js/telefone.js#L164-L165`](/web/public/js/telefone.js#L164-L165)
  ```javascript
  var transportes = driver.id_driver % 3 === 0 ? ['polling'] : ['websocket'];
  ```
  Na bancada, 33% da frota roda forçada em `polling`, refletindo a realidade de áreas com cobertura precária (túneis, rodovias vicinais de Muzambinho).

#### Análise de Impacto Técnico e de Negócio
- **Técnico:** Em HTTP Polling, cada ciclo de comunicação demanda cabeçalhos HTTP completos (User-Agent, Cookies, Content-Type) e renegociações TLS. Conforme modelado em `telefone.js` (`radio.overhead()`), o consumo de dados úteis é inflado em **40% a 100%** por overhead de protocolo e retransmissões TCP.
- **Negócio:** Os motoristas em regiões de sinal mais fraco (normalmente áreas periféricas ou rurais) são justamente os mais penalizados com consumo acelerado de dados e perda de conexão com o despacho de corridas.

#### Abordagem de Correção Recomendada
1. **Configuração de Transporte WebSocket-First Resiliente:**
   Garantir que todos os clientes priorizem WebSocket (`transports: ['websocket', 'polling']`), com políticas de reconexão exponencial com *jitter* aleatório para evitar tempestades de reconexão (*thundering herd*).
2. **Habilitar Compressão WebSocket no Nginx/Gateway (permessage-deflate):**
   Comprimir os frames que ainda trafegarem por HTTP ou WebSocket.
3. **Complexidade Técnica:** Média (ajuste no Nginx e nas opções do Socket.IO client/server).
4. **Complexidade de Negócio:** Baixa.
5. **Impacto Positivo:** Redução do *overhead* de cabeçalhos em conexões instáveis.

---

### Problema 6: Pings Rígidos por Tempo Sem Adaptação de Movimento

#### Evidência Técnica no Código
- O aplicativo dispara `driver.location` a cada 2.000 ms incondicionalmente, mesmo quando o veículo está parado em semáforo ou aguardando passageiro (`speed: 0`).

#### Análise de Impacto Técnico e de Negócio
- **Técnico:** Envio de telemetria estática que não adiciona nenhuma informação nova ao sistema.
- **Negócio:** Consumo desnecessário de bateria e de franquia de dados durante longos períodos de espera.

#### Abordagem de Correção Recomendada
- **Pings Adaptativos (Dead-Reckoning / Delta Mínimo):**
  - Se velocidade < 3 km/h e deslocamento < 10 metros: elevar intervalo de ping de 2s para 10s.
  - Se veículo em movimento acelerado ou curva: manter a cada 2s a 3s.
- **Complexidade Técnica:** Baixa.
- **Complexidade de Negócio:** Baixa.
- **Impacto Positivo:** Redução de até 70% no tráfego de *upload* do motorista em períodos ociosos.

---

## 4. Análise de Viabilidade: Protocol Buffers (Protobuf) vs. JSON

O uso de Protobuf em substituição ao JSON é frequentemente cogitado como solução padrão para telemetria veicular. Segue a avaliação estratégica:

### Por que Protobuf NÃO resolve a crise atual se aplicado isoladamente?
Como demonstrado no cálculo do Problema 1, a raiz do dreno de dados é a taxa de mensagens ($O(N^2)$). Compactar um payload que é disparado 30 vezes por segundo ainda resulta em centenas de megabytes por hora.

### O Papel do Protobuf na Estratégia de Escala (10x e 100x)
Após a correção da arquitetura de difusão (desacoplamento e DTO mínimo), o Protobuf passa a ser uma excelente otimização secundária:

| Aspecto | JSON Compacto (Tuplas `[id, lat, lng, h]`) | Protocol Buffers (Protobuf) |
|---|---|---|
| **Tamanho Médio por Posição** | ~22 bytes | ~8 a 10 bytes (varint/zigzag) |
| **Complexidade no Frontend** | Nula (suporte nativo `JSON.parse`) | Média/Alta (requer compilador de `.proto` ou biblioteca `protobufjs` na aplicação Web/Mobile) |
| **Custo de CPU no Dispositivo** | Baixo em payloads pequenos | Mínimo (parsing binário direto em `ArrayBuffer`) |
| **Observabilidade e Debug** | Alta (legível no Chrome DevTools/Network) | Baixa (quadros binários opacos sem deserializador) |

> **Conclusão:**  
> **Fase 1:** Resolver a arquitetura com JSON otimizado (DTO mínimo + throttling de broadcast), o que elimina 99,9% do consumo de dados imediatamente com custo de desenvolvimento praticamente zero.  
> **Fase 2 (Escala 100x):** Adotar Protobuf quando a frota atingir milhares de veículos simultâneos para economizar CPU móvel e reduzir os últimos 50% de bytes na malha.

---

## 5. Plano de Ação Recomendado (Roadmap de Correção)

### Fase 1 — Contenção Emergencial (Hotfix — 1 a 2 dias)
1. **Remover a emissão de `driver.positions` do handler `aoReceberPosicao`:** O ping do motorista apenas salva a posição e responde com ACK.
2. **Criar um loop desacoplado de broadcast (World Tick) a cada 3 segundos:** Dispara uma única atualização periódica consolidada.
3. **Reduzir o payload para o DTO mínimo:** Enviar apenas `[driverId, lat, lng, heading]`, eliminando CPF, nome, e-mail e dados bancários do broadcast.
4. **Isolar o `city.summary` do `PainelService`:** Garantir que o sumário de corridas seja emitido apenas para a sala `painel:central`.

### Fase 2 — Eficiência e Resiliência (Próxima Sprint — 1 semana)
1. **Filtro de Proximidade (Geofence / Raio de 2 km):** Entregar ao motorista apenas as posições relevantes ao seu campo visual.
2. **Ping Adaptativo no Aplicativo:** Reduzir frequência de envio quando o motorista estiver parado.
3. **Auditoria de Conformidade LGPD:** Formalizar o fluxo seguro de obtenção de dados do motorista no momento do aceite da corrida via HTTPS autenticado.

### Fase 3 — Preparação para Escala 100x (Médio Prazo)
1. **Particionamento Geoespacial com Redis GEO ou Uber H3:** Distribuição horizontal de salas por hexágonos geográficos.
2. **Adoção de Codificação Binária (Protobuf ou codec delta-varint existente no repositório):** Maximizar a autonomia de bateria dos aparelhos.
