Axelar Relayer for Stacks blockchain.

Based on Amplifier API Docs: https://bright-ambert-2bd.notion.site/Amplifier-API-Docs-EXTERNAL-7c56c143852147cd95b1c4a949121851

## Quick start

1. Run `npm install` in the project directory
2. Copy `.env.example` file to `.env` file and update the values
3. Run `docker-compose up -d`
4. Run `npm start:all:watch`

## Dependencies

1. Redis Server is required to be installed [docs](https://redis.io/).
2. PostgreSQL is required to be installed [docs](https://www.postgresql.org/).

In this repo there is a `docker-compose.yml` file providing these services so you can run them easily using `docker-compose up -d`

## Tests

```bash
# unit tests
$ npm run test

# lint
$ npm run lint
```

## Apps

This repo contains of 4 separate apps that can be started & scaled independently if needed.

### axelar-event-processor

Queries the Axelar Amplifier API every 10 seconds for new Tasks. Depending on the task type, it saves required information to the database.

**NOTE: Only ONE instance of this service should run.**

### stacks-event-processor

Queries the Stacks Blockchain API every 10 seconds for new events from the contracts we are interested in. Saves transaction hash to database.

**NOTE: Only ONE instance of this service should run.**

### stacks-transaction-processor

Processes StacksTransaction entries from the database and sends them to the Stacks blockchain. These are currently of type *GATEWAY* and *REFUND*.

**NOTE: Needs to run with the Stacks wallet which is the gas collector in the GasService contract. Multiple instances of this service can run**.

### stacks-scalabe-processors

Processes CrossChainTransaction entries created by the `stacks-event-processor` by querying the Stacks blockchain for each transaction and handling events accordingly.
Also processes MessageApproved entries, by sending EXECUTE transactions to Stacks smart contracts.

**NOTE: This service should run with a different Stacks wallet then the `stacks-transaction-processor`. Multiple instances of this service can run, although for maximum efficiency each instance should have it's own Stacks wallet.**

## Regenerating Typescript interfaces from OpenApi schema file

`npx openapicmd typegen ./libs/common/src/assets/axelar-gmp-api.schema.yaml > ./libs/common/src/api/entities/axelar.gmp.api.d.ts`

## Manual Relaying

You can manually relay messages using simple commands instead of running the whole Relayer stack, which also requires the Axelar Amplifier API.

Make sure your `.env` file is updated with the correct addresses for contracts, and includes the optional env vars for these commands:

```dotenv
AXELAR_MNEMONIC=
AXELAR_RPC_URL=
AXELAR_GAS_PRICE=
AXELAR_VOTING_VERIFIER_CONTRACT=
AXELAR_CHAIN_GATEWAY_CONTRACT=

AVAILABLE_GAS_CHECK_ENABLED=false # make sure this is set to false to ignore cross chain gas fess when manually relaying
```

Note: Commands may hang at the end, it is safe to close them after getting the success or error message.

### Stacks -> ITS Hub

#### Verifying Messages

Can be used to verify any message, from Stacks ITS or from other contracts as well.

```shell
npm run cli verify-message <stacks tx hash>
```

#### Executing on ITS Hub

This should only be used for executing messages from the Stacks ITS towards ITS Hub

```shell
npm run cli its-hub-execute <stacks tx hash>
```

### ITS Hub -> Stacks

#### Construct Proof

```shell
npm run cli construct-proof <axelar tx hash>
```

#### Stacks Execute

- for interchain transfer:

```shell
npm run cli stacks-execute <axelar tx hash>
```

- for deploying native interchain token

```shell
npm run cli stacks-execute <axelar tx hash> -- --step CONTRACT_DEPLOY # 1st step
npm run cli stacks-execute <axelar tx hash> -- --step CONTRACT_SETUP --contract-id <previously deployed stacks contract id> # 2nd step
npm run cli stacks-execute <axelar tx hash> -- --step ITS_EXECUTE --contract-id <previously deployed stacks contract id> --deploy-tx-hash <previously returned tx hash from step 1> # 3rd step
```