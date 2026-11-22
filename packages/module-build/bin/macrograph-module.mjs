#!/usr/bin/env node
import { main } from "../src/Cli.ts";

process.exitCode = await main(process.argv.slice(2));
