# Desafio prático — Engenheiro(a) de Software Sênior, Backend

Bem-vindo. Este repositório é um recorte controlado da nossa plataforma de
mobilidade: a API de tempo real, o banco de corridas e uma bancada visual que
simula motoristas em operação.

Seu trabalho começa com um chamado aberto pelo suporte.

---

## O chamado

> **Chamado #4471 — Suporte / Financeiro — prioridade alta**
>
> Motoristas de Muzambinho vêm reclamando que o aplicativo consome o pacote de
> dados deles.
>
> O financeiro sinalizou que a linha de saída de dados do provedor de
> infraestrutura subiu.
>
> Precisamos entender o que está acontecendo e o que fazer a respeito.

Ninguém sabe a causa. Faz parte do desafio descobrir.

---

## Subindo o ambiente

Requisitos: Docker e Docker Compose.

```bash
docker compose up -d --build
```

O ambiente está pronto quando a API responder:

```bash
curl -s localhost:3000/health
```

Nos primeiros segundos a API reinicia uma ou duas vezes com `ECONNREFUSED` no
MySQL — é esperado, o `restart: unless-stopped` cuida disso. O seed carrega
cerca de 100 mil corridas.

Portas usadas no host — precisam estar livres:

- **Bancada visual:** http://localhost:8080
- **API:** http://localhost:3000
- **Coletor de telemetria:** http://localhost:9000 — `/stats` e `/handshake`
- **MySQL:** `localhost:3306` — banco `mobilidade`, usuário `mobilidade`, senha `mobilidade`
- **Redis:** `localhost:6379`

Na bancada, o botão **Iniciar teste** conecta os 6 aparelhos e a frota de fundo.
Cada aparelho roda uma corrida completa de cerca de 40 segundos; a frota apenas
circula pela malha emitindo posição. Deixe rodar até o fim pelo menos uma vez
antes de tirar conclusões.

Sem apertar o botão, **nenhum motorista fica online** — a frota só conecta
quando a simulação é ativada.

Para derrubar tudo, inclusive os dados:

```bash
docker compose down -v
```

---

## O que esperamos da entrega

Um repositório Git com o seu trabalho e um `README.md` na raiz descrevendo:

- o diagnóstico
- as decisões tomadas

### Sobre uso de IA

Pode usar. Não vamos perguntar e não vamos penalizar.

O que avaliamos é a entrega e a sua capacidade de sustentá-la: na etapa
seguinte você vai conversar com a gente sobre as decisões deste repositório.

---

## Diagnóstico e Decisões Tomadas (Chamado #4471)

O diagnóstico detalhado, cobrindo impacto técnico e de negócio na base atual, projeções a 10x e 100x de escala, análise de conformidade LGPD e estudo de viabilidade sobre Protocol Buffers (Protobuf) está documentado na íntegra em:

📄 **[`docs/DIAGNOSTICO_CONSUMO_DADOS.md`](docs/DIAGNOSTICO_CONSUMO_DADOS.md)**

### Resumo das Decisões e Correções Aplicadas

1. **Desacoplamento de Broadcast $O(N^2)$ (Issue 1):** A ingestão de pings de localização (`driver.location`) foi desacoplada da difusão. Implementado um broadcast periódico (*World Tick* com intervalo configurável de 2.000 ms), eliminando a tempestade quadrática de pacotes e reduzindo em >95% o tráfego nos celulares.
2. **Sanitização de Payload e Conformidade LGPD (Issue 2):** Criado o DTO público `MotoristaPosicaoPublica` contendo estritamente os dados necessários para o mapa (`driverId`, `latitude`, `longitude`, `heading`). Dados pessoais e bancários (CPF, conta bancária, saldo da carteira, e-mail, telefone) foram removidos do fluxo em tempo real, reduzindo o tamanho de cada registro em ~89%.
3. **Isolamento de Salas do Painel (Issue 3):** O evento periódico `city.summary` do `PainelService` foi direcionado estritamente para as salas de central (`painel:<cityId>` e `painel:central`) através de `emitToRoom`, eliminando o vazamento de resumos de corridas de back-office para os celulares dos motoristas.
4. **Testes Automatizados:** Criada suíte completa de testes com o test runner nativo do Node.js e `tsx` (`npm test`), validando todas as correções implementadas e garantindo que novos testes passem sem regressões.

---

## Mapa do repositório

```
docker-compose.yml   seis serviços: mysql, redis, api, coletor, frota, web
api/                 API Node.js — tempo real, corridas, precificação, telemetria
  src/               código da aplicação
  vendor/            integrações de terceiros com patch local
docs/                documentação técnica e de negócio
  DIAGNOSTICO_CONSUMO_DADOS.md  relatório detalhado de causas, escala e mitigação (chamado #4471)
web/                 bancada visual (HTML/CSS/JS sem build)
  nginx.conf         serve a bancada e faz proxy de /api e /socket.io
db/init.sql          schema e seed
```

Três containers saem da mesma imagem `./api`, com entrypoints diferentes:

- **`api`** — a aplicação (`src/main.ts`)
- **`frota`** — simulador de motoristas (`src/sim/fleet.ts`); fala com a API
  pelo mesmo caminho que o aplicativo do motorista usa
- **`coletor`** — agente local de observabilidade (`src/coletor.ts`)

Boa investigação.
