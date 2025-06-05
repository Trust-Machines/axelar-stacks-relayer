Axelar Relayer for Stacks blockchain.

Based on Amplifier API Docs: https://bright-ambert-2bd.notion.site/Amplifier-API-Docs-EXTERNAL-7c56c143852147cd95b1c4a949121851

## Quick start

1. Run `npm install` in the project directory
2. Copy `.env.example` file to `.env` file and update the values
3. Run `docker-compose up -d`
4. Run `npm start` or `npm start:axelar-event-processor`

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
```

### Verifying Messages

```shell
npm run cli verify-message <stacks tx hash>
```