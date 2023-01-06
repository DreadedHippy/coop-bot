import { GatewayIntentBits, Client, ActionRowBuilder, ButtonBuilder, ButtonStyle, SelectMenuBuilder, REST, Routes, WebhookClient } from 'discord.js';
import _ from 'lodash';
import Database from 'coop-shared/setup/database.mjs';
import secrets from 'coop-shared/setup/secrets.mjs';
import COOP, { CHANNELS, CHICKEN, ITEMS, MESSAGES, REACTIONS, ROLES, SERVER, STATE, TIME, USERS } from '../coop.mjs';
import setupCommands from './commands.mjs';
import { BOTS, EMOJIS } from 'coop-shared/config.mjs';
import RolesHelper from '../operations/members/hierarchy/roles/rolesHelper.mjs';
import Items from 'coop-shared/services/items.mjs';

import TradingHelper from '../operations/minigames/medium/economy/items/tradingHelper.mjs';
import Trading from 'coop-shared/services/trading.mjs';
import StockHelper from '../operations/stock/stockHelper.mjs';
import Chicken from '../operations/chicken.mjs';
import ActivityHelper from '../operations/activity/activityHelper.mjs';
import UsersHelper from '../operations/members/usersHelper.mjs';
import TemporaryMessages from '../operations/activity/maintenance/temporaryMessages.mjs';
import SocialHelper from '../operations/social/socialHelper.mjs';
import UserRoles from 'coop-shared/services/userRoles.mjs';
import DatabaseHelper from 'coop-shared/helper/databaseHelper.mjs';
import SacrificeHelper from '../operations/members/redemption/sacrificeHelper.mjs';
import ProjectsHelper from '../operations/productivity/projects/projectsHelper.mjs';


// Commonly useful.
const listenReactions = (fn) => COOP.STATE.CLIENT.on('messageReactionAdd', fn);
const listenChannelUpdates = (fn) => COOP.STATE.CLIENT.on('channelUpdate', fn);
const listenMessages = (fn) => COOP.STATE.CLIENT.on('messageCreate', fn);
const listenVoiceState = (fn) => COOP.STATE.CLIENT.on('voiceStateUpdate', fn);

const shallowBot = async () => {
    console.log('Starting shallow bot');

    // Load secrets.
    await secrets();

    // Instantiate a CommandoJS "client".
    COOP.STATE.CLIENT = new Client({ 
        owner: '786671654721683517',
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.DirectMessages,
            GatewayIntentBits.DirectMessageReactions,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildMessageReactions,
            GatewayIntentBits.GuildPresences,
            GatewayIntentBits.GuildVoiceStates
        ]
    });

    // Connect to Postgres database.
    await Database.connect();

    // Login, then wait for the bot to be fully online before testing.
    await COOP.STATE.CLIENT.login(process.env.DISCORD_TOKEN);

    // Common checks:
    // COOP.STATE.CLIENT.on('ready', () => ServerHelper.checkMissingChannels());
    // COOP.STATE.CLIENT.on('ready', () => SERVER.checkMissingRoles());

    // setupCommands(COOP.STATE.CLIENT);

    COOP.STATE.CLIENT.on('ready', async () => {
        console.log('Shallow bot is ready');

        // const txs = await ITEMS.getTransactions();
        const txsPrevDay = await CHICKEN.getTransactionsPreviousDay();
        const summarisedTxs = ActivityHelper.summariseTransactions(txsPrevDay);
        console.log(txsPrevDay);
        console.log(summarisedTxs);
        
        
        // listenMessages(RolesHelper.onWebookMessage);

        // COOP.STATE.CLIENT.on('interactionCreate', async interaction => {
        //     console.log(interaction);

        //     TradingHelper.onInteractionCreate(interaction, COOP.STATE.CLIENT);
        // });

        // Try to add a gold coin to the button as emoji

        // ROLES._add('233416843031871490', 'LEADER');
        // Items.add('233416843031871490', 'LEADERS_SWORD', 1, 'Election failed, manual patch.');


        // SacrificeHelper.announce();
        

        // console.log(TIME.parseHuman('a week from now').getTime());
        // const tannoy = USERS._getMemberByID('221879800900354048');
        // ProjectsHelper.create('galactic-commander', tannoy, 'a week from now');

        // const query = {
        //     text: `SELECT * FROM projects`,
        // };
        
        // const resp = await Database.query(query);
        // console.log(resp.rows);


        // TODO: Post video
        // 

        // Add play button to it

        const gameLoginLink = 'https://discord.com/api/oauth2/authorize?method=discord_oauth&client_id=799695179623432222' +
        "&redirect_uri=https%3A%2F%2Fthecoop.group%2Fauth%2Fauthorise&response_type=code&scope=identify&state=game";
  
      // Add informative buttons to the message.
      const msg = await CHANNELS._send('ADVERTS', 'https://cdn.discordapp.com/attachments/894438360846848050/1058258255467515914/testing.mp4');
      msg.edit({ components: [		
        new ActionRowBuilder().addComponents([
          new ButtonBuilder()
            .setEmoji('🌎')
            .setLabel("Conquest")
            .setURL(gameLoginLink)
            .setStyle(ButtonStyle.Link)
        ])]
      });
    });
};

shallowBot();




// NOTES BELOW



// DEV WORK AND TESTING ON THE LINES BELOW.


