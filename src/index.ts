import { Connection, PublicKey } from "@solana/web3.js";
import fetch from "isomorphic-fetch";
import JSBI from "jsbi";
import {
  getPlatformFeeAccounts,
  Jupiter,
  RouteInfo,
  TOKEN_LIST_URL,
} from "@jup-ag/core";
import Decimal from "decimal.js";
import {
  ENV,
  INPUT_MINT_ADDRESS,
  OUTPUT_MINT_ADDRESS,
  SOLANA_RPC_ENDPOINT,
  Token,
  USER_KEYPAIR,
} from "./constants";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

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
      `Getting routes for ${inputAmount} ${inputToken.symbol} -> ${outputToken.symbol}...`
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
      console.log("Possible number of routes:", routes.routesInfos.length);
      console.log(
        "Best quote:",
        JSBI.toNumber(routes.routesInfos[0].outAmount) /
          10 ** outputToken.decimals,
        `(${outputToken.symbol})`
      );

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
      console.log(`https://explorer.solana.com/tx/${swapResult.txid}`);
      console.log(
        `inputAddress=${swapResult.inputAddress.toString()} outputAddress=${swapResult.outputAddress.toString()}`
      );
      console.log(
        `inputAmount=${swapResult.inputAmount.toString()} outputAmount=${swapResult.outputAmount.toString()}`
      );
    }
  } catch (error) {
    throw error;
  }
};

const main = async () => {
  try {
    const connection = new Connection(SOLANA_RPC_ENDPOINT); // Setup Solana RPC connection
    const tokens: Token[] = await (await fetch(TOKEN_LIST_URL[ENV])).json(); // Fetch token list from Jupiter API

    // If you want to add platformFee as integrator: https://docs.jup.ag/jupiter-core/adding-platform-fees
    const platformFeeAndAccounts = {
      feeBps: 50,
      feeAccounts: await getPlatformFeeAccounts(
        connection,
        new PublicKey("BUX7s2ef2htTGb2KKoPHWkmzxPj4nTWMWRgs5CSbQxf9") // The platform fee account owner
      ),
    };

    //  Load Jupiter
    const jupiter = await Jupiter.load({
      connection,
      cluster: ENV,
      user: USER_KEYPAIR, // or public key
      platformFeeAndAccounts,
    });

    //  Get routeMap, which maps each tokenMint and their respective tokenMints that are swappable
    const routeMap = jupiter.getRouteMap();

    // If you know which input/output pair you want
    const inputToken = tokens.find((t) => t.address == INPUT_MINT_ADDRESS); // USDC Mint Info
    const outputToken = tokens.find((t) => t.address == OUTPUT_MINT_ADDRESS); // USDT Mint Info

    // Alternatively, find all possible outputToken based on your inputToken
    const possiblePairsTokenInfo = await getPossiblePairsTokenInfo({
      tokens,
      routeMap,
      inputToken,
    });

    // const routes = await getRoutes({
    //   jupiter,
    //   inputToken,
    //   outputToken,
    //   inputAmount: 1, // 1 unit in UI
    //   slippage: 1, // 1% slippage
    // });

    const usdcToken = tokens.find((t) => t.address === USDC_MINT)!;
    const amount = 5; // arbitrary small amount

    for (let i = 0; i < 1000; ++i) {
      tryToExecuteSwap(amount, usdcToken, jupiter);
      await new Promise((resolve) => setTimeout(resolve, 10000)); // Timed in miliseconds so this is ten seconds
    }

    // Routes are sorted based on outputAmount, so ideally the first route is the best.
    // await executeSwap({ jupiter, routeInfo: routes!.routesInfos[0] });
  } catch (error) {
    console.log({ error });
  }
};

main();

async function getBestRouteToSelf(
  amount: number,
  token: Token,
  jupiter: Jupiter
) {
  const routes = await getRoutes({
    jupiter,
    inputToken: token, // input token
    outputToken: token, // output token
    inputAmount: amount, // 5 USDC unit in UI
    slippage: 0.0, // 0% slippage
  });
  return routes?.routesInfos[0];
}

async function tryToExecuteSwap(
  amount: number,
  token: Token,
  jupiter: Jupiter
) {
  const bestRoute = await getBestRouteToSelf(amount, token, jupiter);

  // const bestoutAmountwithSlippage = JSBI.toNumber(bestRoute!.otherAmountThreshold) ?? 0;
  const bestoutAmountwithSlippage = (bestRoute != undefined && 'otherAmountThreshold' in bestRoute) ? (JSBI.toNumber(bestRoute!.otherAmountThreshold) ?? 0) : 0;
  const inputUSDCWithDecimals = token ? Math.round(amount * 10 ** token.decimals) : 0;
  console.log(
    bestoutAmountwithSlippage + "\n",
    inputUSDCWithDecimals + "\n",
    typeof bestoutAmountwithSlippage + "\n",
    typeof inputUSDCWithDecimals + "\n"
  );
  console.log("bestRoute", bestRoute);
  if (bestoutAmountwithSlippage > inputUSDCWithDecimals) {
    console.log("executing");
    await executeSwap({ jupiter, routeInfo: bestRoute! });
  }
}
