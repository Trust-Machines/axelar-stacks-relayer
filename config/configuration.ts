import * as process from 'process';

require("dotenv").config({
  path: process.env.NODE_ENV == 'test' ? '.env.test' : '.env',
});

export default () => process.env;
