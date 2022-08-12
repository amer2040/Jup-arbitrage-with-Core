import { Connection, PublicKey } from '@solana/web3.js';
import fetch from 'isomorphic-fetch';
import JSBI from "jsbi";
import { Jupiter, RouteInfo, TOKEN_LIST_URL } from '@jup-ag/core';
import Decimal from "decimal.js";
import {
  ENV,
  INPUT_MINT_ADDRESS,
  OUTPUT_MINT_ADDRESS,
  SOLANA_RPC_ENDPOINT,
  Token,
  USER_KEYPAIR,
} from './constants';

const getPossiblePairsTokenInfo = ({
  tokens,
  routeMap,
  inputToken,
}: {
  tokens: Token[];
  routeMap: Map<string, string[]>;
  inputToken?: Token;
}) => {
  try {
    if (!inputToken) {
      return {};
    }

    const possiblePairs = inputToken
      ? routeMap.get(inputToken.address) || []
      : []; // return an array of token mints that can be swapped with SOL
    const possiblePairsTokenInfo: { [key: string]: Token | undefined } = {};
    possiblePairs.forEach((address) => {
      possiblePairsTokenInfo[address] = tokens.find((t) => {
        return t.address == address;
      });
    });
    // Perform your conditionals here to use other outputToken
    // const alternativeOutputToken = possiblePairsTokenInfo[USDT_MINT_ADDRESS]
    return possiblePairsTokenInfo;
  } catch (error) {
    throw error;
  }
};

const getRoutes = async ({
  jupiter,
  inputToken,
  outputToken,
  inputAmount,
  slippage,
}: {
  jupiter: Jupiter;
  inputToken?: Token;
  outputToken?: Token;
  inputAmount: number;
  slippage: number;
}) => {
  try {
    if (!inputToken || !outputToken) {
      return null;
    }

    console.log(
      `Getting routes for ${inputAmount} ${inputToken.symbol} -> ${outputToken.symbol}...`,
    );
    const inputAmountInSmallestUnits = inputToken
      ? Math.round(inputAmount * 10 ** inputToken.decimals)
      : 0;
    const routes =
      inputToken && outputToken
        ? await jupiter.computeRoutes({
          inputMint: new PublicKey(inputToken.address),
          outputMint: new PublicKey(outputToken.address),
          amount: JSBI.BigInt(inputAmountInSmallestUnits), // raw input amount of tokens
          slippage,
          forceFetch: true,
          onlyDirectRoutes: false
        })
        : null;

    if (routes && routes.routesInfos) {
      console.log('Possible number of routes:', routes.routesInfos.length);
      console.log(
        "Best quote:",
        JSBI.toNumber(routes.routesInfos[0].outAmount) /
          10 ** outputToken.decimals,
        `(${outputToken.symbol})`
      )
      return routes;
    } else {
      return null;
    }
  } catch (error) {
    // throw ;
    return null;
  }
};

const executeSwap = async ({
  jupiter,
  routeInfo,
}: {
  jupiter: Jupiter;
  routeInfo: RouteInfo;
}) => {
  try {
    // Prepare execute exchange
    const { execute } = await jupiter.exchange({
      routeInfo,
    });

    // Execute swap
    const swapResult: any = await execute(); // Force any to ignore TS misidentifying SwapResult type

    if (swapResult.error) {
      console.log(swapResult.error);
    } else {
      console.log(`https://solscan.io/tx/${swapResult.txid}`);
      console.log(
        `inputAddress=${swapResult.inputAddress.toString()} outputAddress=${swapResult.outputAddress.toString()}`,
      );
      console.log(
        `inputAmount=${swapResult.inputAmount.toString()} outputAmount=${swapResult.outputAmount.toString()}`,
      );
    }
  } catch (error) {
    throw error;
  }
};

// TODO: remove console.logs as those cost precious miliseconds
const pingSwap = async (
  inputAmount: number,
  inputAmountWithoutDecimals: number,
  inputToken: Token,
  outputToken: Token,
  jupiter: Jupiter,
) => {
  try {
    const routes = await getRoutes({
      jupiter,
      inputToken,
      outputToken,
      inputAmount, // 1 unit in UI
      slippage: 0.2, // .2% slippage
    });

    const bestRoute = routes?.routesInfos[0];
     console.log(bestRoute);
    if (JSBI.toNumber((bestRoute!.otherAmountThreshold ?? 0)) > inputAmountWithoutDecimals) {
      console.log(
        'running',
        bestRoute?.otherAmountThreshold,
        inputAmountWithoutDecimals,
      );
      await executeSwap({ jupiter, routeInfo: routes!.routesInfos[0] });
    } else {
      console.log(
        'not executing',
        JSBI.toNumber(bestRoute!.otherAmountThreshold),
        '<',
        inputAmountWithoutDecimals,
      );
    }
  } catch (e) {
    console.log(e);
  }
};

const main = async () => {
  const connection = new Connection(SOLANA_RPC_ENDPOINT); // Setup Solana RPC connection
  const tokens: Token[] = await (await fetch(TOKEN_LIST_URL[ENV])).json(); // Fetch token list from Jupiter API

  //  Load Jupiter
  const jupiter = await Jupiter.load({
    connection,
    cluster: ENV,
    user: USER_KEYPAIR, // or public key
  });

  //  Get routeMap, which maps each tokenMint and their respective tokenMints that are swappable
  const routeMap = jupiter.getRouteMap();
  const inputToken = tokens.find((t) => t.address === INPUT_MINT_ADDRESS); // USDC Mint Info
  const outputToken = tokens.find((t) => t.address === OUTPUT_MINT_ADDRESS); // USDT Mint Info

  if (inputToken != null && outputToken != null) {
    setInterval(
      () => pingSwap(5, 5000000, inputToken, outputToken, jupiter),
      15000,
    );
    //setInterval(
    // () => pingSwap(0.01, 1000000, inputToken, outputToken, jupiter),
    // 15000,
    //);
    // setInterval(
    //   () => pingSwap(10, 10000000, inputToken, outputToken, jupiter),
    //   15000,
    // );
  }
};

main();
