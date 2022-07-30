require("dotenv").config();

//FireBase
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const dbRef = admin.firestore().doc("tokens/info");

//Twitter
const TwitterApi = require("twitter-api-v2").default;
const twitterClient = new TwitterApi({
  clientId: process.env.TWITTER_CLIENT_ID,
  clientSecret: process.env.TWITTER_CLINET_SECRET,
});

//GPT-3
const { Configuration, OpenAIApi } = require("openai");
const configuration = new Configuration({
  apiKey: process.env.OPENAIKEY,
});
const openai = new OpenAIApi(configuration);

const callbackURL = process.env.CALLBACKURL;

exports.auth = functions.https.onRequest(async (request, response) => {
  const { url, codeVerifier, state } = twitterClient.generateOAuth2AuthLink(
    callbackURL,
    { scope: ["tweet.read", "tweet.write", "users.read", "offline.access"] }
  );
  await dbRef.set({ codeVerifier, state });
  response.redirect(url);
});

exports.callback = functions.https.onRequest(async (request, response) => {
  const { state, code } = request.query;
  const dbSnapshot = await dbRef.get();
  const { codeVerifier, state: storedState } = dbSnapshot.data();
  if (state !== storedState) {
    return response.status(400).send("Tokens Did Not Match!");
  }
  const {
    client: loggedClient,
    accessToken,
    refreshToken,
  } = await twitterClient.loginWithOAuth2({
    code,
    codeVerifier,
    redirectUri: callbackURL,
  });
  await dbRef.set({ accessToken, refreshToken });
  response.sendStatus(200);
});

exports.tweet = functions.https.onRequest(async (request, response) => {
  const { refreshToken } = (await dbRef.get()).data();
  const {
    client: refreshedClient,
    accessToken,
    refreshToken: newRefreshToken,
  } = await twitterClient.refreshOAuth2Token(refreshToken);
  await dbRef.set({ accessToken, refreshToken: newRefreshToken });

  const tweet = await openai.createCompletion({
    model: "text-davinci-002",
    prompt: process.env.PROMPT,
    temperature: 1,
    max_tokens: 50,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });

  const { data } = await refreshedClient.v2.tweet(tweet.data.choices[0].text);
  response.send(data);
});
