import VotingHelper from '../../activity/redemption/votingHelper.mjs';

import { EMOJIS, CHANNELS } from 'coop-shared/config.mjs';
import CooperMorality from '../../minigames/small/cooperMorality.mjs';

import COOP, { MESSAGES, ROLES, USERS, SERVER } from '../../../coop.mjs';
import TemporaryMessages from '../../activity/maintenance/temporaryMessages.mjs';
import Items from 'coop-shared/services/items.mjs';
import { ButtonStyle, ActionRowBuilder, ButtonBuilder } from 'discord.js';

export const SACRIFICE_RATIO_PERC = .05;
export const KEEP_RATIO_PERC = .02;

const sacrificeDuration = 60 * 60 * 12;
const sacrificeMsgLifetime = 60 * 60 * 12;

export default class SacrificeHelper {

    static loadOffers() {
        return TemporaryMessages.getType('SACRIFICE');
    }

    static isReactionSacrificeVote(reaction, user) {
        const emoji = reaction.emoji.name;
        const isVoteEmoji = [EMOJIS.DAGGER, EMOJIS.SACRIFICE_SHIELD].indexOf(emoji) > -1;
        const channelID = reaction.message.channel.id;

        if (user.bot) return false;
        if (!isVoteEmoji) return false;
        if (channelID !== CHANNELS.ABOUT.id) return false;

        // Guards passed.
        return true;
    }

    static isBackDagger(reaction, user) {
        const emoji = reaction.emoji.name;
        const isDagger = COOP.MESSAGES.emojiToUni(emoji) === COOP.MESSAGES.emojiToUni(EMOJIS.DAGGER);

        // if (isSacrificeChannel) return false;
        if (user.bot) return false;
        if (reaction.message.author.bot) return false;
        if (!isDagger) return false;

        // Guards passed.
        return true;
    }

    static async onReaction(reaction, user) {
        // Is back dagger
        if (this.isBackDagger(reaction, user)) {
            this.processBackDagger(reaction, user);
        }

        // Process the vote.
        if (this.isReactionSacrificeVote(reaction, user)) {
            this.processVote(reaction, user);
        }
    }

    static async processVote(reaction, user) {
        const guild = COOP.SERVER._coop();

        // Try to access sacrificee from message
        try {
            const sacrificeEmbedDesc = reaction.message?.embeds[0].data.description;

            // Ignore reaction on non-sacrifice message.
            if (!sacrificeEmbedDesc) return;

            const sacrificeeID = /<@(\d+)>/.exec(sacrificeEmbedDesc)[1];

            if (!sacrificeeID)
                throw new Error('Could not discern sacrificee from sacrifice embed');

            const targetMember = await COOP.USERS.fetchMemberByID(guild, sacrificeeID);
            const isProspect = ROLES._idHasCode(sacrificeeID, 'PROSPECT');

            // Prevent trying to sacrifice someone that was already sacrificed.
            if (!targetMember)
                return COOP.MESSAGES.selfDestruct(reaction.message, `Member with id ${sacrificeeID} seems not to be present for sacrificing.`);

            // If target member is self, remove vote.
            if (user.id === sacrificeeID) {
                // Remove vote.
                reaction.users.remove(user.id);

                // Warn.
                return COOP.MESSAGES.selfDestruct(reaction.message, `${user.username} you can't vote for/against yourself. :dagger:`);
            }

            // Prevent PROSPECTS from kicking people out.
            if (ROLES._idHasCode(user.id, 'PROSPECT')) {
                reaction.users.remove(user.id);
                return COOP.MESSAGES.selfDestruct(reaction.message, `${user.username} you can't vote as a PROSPECT. :dagger:`);
            }

            // If member left, don't do anything.
            if (!targetMember) return false;
            
            // Calculate the number of required votes for the redemption poll.
            const reqSacrificeVotes = VotingHelper.getNumRequired(SACRIFICE_RATIO_PERC);
            const reqKeepVotes = VotingHelper.getNumRequired(KEEP_RATIO_PERC);
        
            // Get existing reactions on message.
            let sacrificeVotes = 0;
            let keepVotes = 0;
            reaction.message.reactions.cache.map(reactionType => {
                if (reactionType.emoji.name === EMOJIS.DAGGER) sacrificeVotes = Math.max(0, reactionType.count - 1);
                if (reactionType.emoji.name === EMOJIS.SACRIFICE_SHIELD) keepVotes = Math.max(0, reactionType.count - 1);
            });


            // Process votes with feedback for currently unprotected user.
            const missingKeepVotes = reqKeepVotes - keepVotes;
            if (missingKeepVotes > 0) {
                const remainingProtectVotes = Math.max(0, missingKeepVotes);
                const remainingSacrificeVotes = Math.max(0, reqSacrificeVotes - sacrificeVotes);   

                // Check if enough votes to sacrifice.
                if (remainingSacrificeVotes <= 0) {
                    // Notify when user is voted out.
                    await COOP.CHANNELS._send('TALK',
                        (isProspect ? 'Prospect ' : '') + `<@${sacrificeeID}> was sacrificed!`);
                    await targetMember.ban();

                    // User was sacrificed - clear sacrifice message.
                    MESSAGES.delayDelete(reaction.message, 500);

                } else {
                    const sacrificeUpdatetitle = `**Remaining votes to sacrifice ${targetMember.user.username}**`;
                    const sacrificeText = (
                        sacrificeUpdatetitle +
                        `\n\n` +
                        `Protect: ${EMOJIS.SACRIFICE_SHIELD} ${remainingProtectVotes} ${EMOJIS.SACRIFICE_SHIELD}` +
                        `| Sacrifice: ${EMOJIS.DAGGER} ${remainingSacrificeVotes} ${EMOJIS.DAGGER}`
                    );

                    // Track whether to post an sacrifice info message or update existing one.
                    let updatingMsgInstead = false;

                    // Check if the message is already within the past 5 feed messages (if so update it and reduce spam).
                    const feed = COOP.CHANNELS._getCode('TALK');
                    const latestMsgs = await feed.messages.fetch({ limit: 10 });
                    latestMsgs.map(m => {
                        if (m.content.includes(sacrificeUpdatetitle)) {
                            m.edit(sacrificeText);
                            updatingMsgInstead = true;
                        }
                    });

                    // Provide feedback for user who is not currently protected or sacrificed.
                    if (!updatingMsgInstead)
                        COOP.CHANNELS._send('TALK', sacrificeText);
                }

            // Intercept latest vote granted protection to user.
            } else if (missingKeepVotes <= 0 && reaction.emoji.name === EMOJIS.SACRIFICE_SHIELD) {
                let savedText = `<@${sacrificeeID}> was protected from sacrifice by votes!`;
                if (isProspect) {
                    savedText = `Prospect <@${targetMember.id}> survives sacrifice and is no longer marked as PROSPECT!`
                    ROLES._remove(sacrificeeID, 'PROSPECT');
                }
                COOP.CHANNELS._send('TALK', savedText);

                // User survived clear sacrifice message.
                MESSAGES.delayDelete(reaction.message, 500);
            } 

        } catch(e) {
            console.error(e);
        }
    }

    static async processBackDagger(reaction) {
        const guild = COOP.SERVER._coop();

        // Calculate the number of required votes for the redemption poll.
        const reqSacrificeVotes = VotingHelper.getNumRequired(SACRIFICE_RATIO_PERC);
    
        // Get existing reactions on message.
        let sacrificeVotes = 0;
        reaction.message.reactions.cache.map(reactionType => {
            const emoji = reactionType.emoji.name;
            if (COOP.MESSAGES.emojiToUni(emoji) === COOP.MESSAGES.emojiToUni(EMOJIS.DAGGER)) {
                sacrificeVotes = reactionType.count;
            }
        });

        // Limit this to only reaction to a certain count of emojis, fire once.
        if (sacrificeVotes === reqSacrificeVotes) {
            const targetID = reaction.message.author.id;
            const targetMember = await COOP.USERS.fetchMemberByID(guild, targetID);

            // TODO: Award points to backstabbers
            // TODO: Award points for successfully removing a backstabbed member.
            // TODO: Also reward points for approving/rejecting an incoming member (reward more for rejection)
            // TODO: limit number of sacrifices to a maximum of five by checking the number of messages in the sacrifice channel

            await this.offer(targetMember.user);

            setTimeout(async () => {
                // May have got stabbed more in the past 3 seconds.
                // TODO: Implement backstabbers list.
                let updatedNumVotes = sacrificeVotes;
                // const backstabbers = [];
                reaction.message.reactions.cache.map(reactionType => {
                    const emoji = reactionType.emoji.name;
                    if (emoji === EMOJIS.DAGGER) updatedNumVotes = reactionType.count;
                });

                // const backstabMsg = 
                await reaction.message.channel.send(
                    `${targetMember.user.username} got backstabbed! ${EMOJIS.DAGGER.repeat(updatedNumVotes)}`
                );
            }, 3000);
        }
    }

    static async getLastSacrificeSecs(userID) {
        const lastSacSecs = await COOP.USERS.getField(userID, 'last_sacrificed_secs');
        return lastSacSecs;
    }

    static async offer(user) {
        // Check last sacrifice time
        const lastSacSecs = await this.getLastSacrificeSecs(user.id);
        
        // If happened within past week, prevent.
        const lastWeek = COOP.TIME._secs() - ((60 * 60) * 24) * 7;

        // Ignore null lastSacSecs, these players have never been sacrificed before... no reason not to choose them. :D
        if (lastSacSecs >= lastWeek) {
            const sparedText = `${user.username} was considered for sacrifice but spared.`;
            return COOP.CHANNELS._send('ACTIONS', sparedText);
        }

        // If there is a previous sacrifice and the user still has prospect role (implies survived) remove role.
        if (lastSacSecs && ROLES._idHasCode(user.id, 'PROSPECT')) {
            await ROLES._remove(user.id, 'PROSPECT');

            const deprospectedText = `${user.username} survived their last sacrifice and is no longer considered a prospect`;
            return COOP.CHANNELS._send('ACTIONS', deprospectedText);
        }

        // Show some basic user statistics on the sacrifice message.
        let lastMessageFmt = 'unknown';

        // Try to access and format last_msg_secs data.v
        const lastMsgSecs = await COOP.USERS.getField(user.id, 'last_msg_secs');
        if (lastMsgSecs) lastMessageFmt = COOP.TIME.secsLongFmt(lastMsgSecs);

        const points = await Items.getUserItemQty(user.id, 'COOP_POINT');
        const totalItems = await COOP.ITEMS.getUserTotal(user.id);

        const cooperMood = await CooperMorality.load();

        let moodText = '';
        const tenRoll = COOP.STATE.CHANCE.bool({ likelihood: 6 });
        const twentyRoll = COOP.STATE.CHANCE.bool({ likelihood: 4 });
        const twoRoll = COOP.STATE.CHANCE.bool({ likelihood: 2 });
        const oneRoll = COOP.STATE.CHANCE.bool({ likelihood: 1 });

        if (tenRoll && cooperMood === 'EVIL') moodText = ' (and I hope you are)';
        if (twentyRoll && cooperMood === 'EVIL') moodText = ' lol';
        if (twoRoll && cooperMood === 'EVIL') moodText = ' (been looking forward to this one)';
        if (oneRoll && cooperMood === 'EVIL') moodText = ', ha';

        if (tenRoll && cooperMood === 'GOOD') moodText = ' (and I hope they don\'t)';
        if (twentyRoll && cooperMood === 'GOOD') moodText = ' ;(';
        if (twoRoll && cooperMood === 'GOOD') moodText = ' nooooooooo';
        if (oneRoll && cooperMood === 'GOOD') moodText = ' violence never solved anything.';

        if (tenRoll && cooperMood === 'NEUTRAL') moodText = ' it\'s a shame it had to come to this.';
        if (twentyRoll && cooperMood === 'NEUTRAL') moodText = ' this is Coop standard HR practise';
        if (twoRoll && cooperMood === 'NEUTRAL') moodText = ' it is what it is';
        if (oneRoll && cooperMood === 'NEUTRAL') moodText = ' just awaiting the paperwork';
        if (oneRoll && twentyRoll && cooperMood === 'NEUTRAL') moodText = ' all sacrificial rights reserved, The Coop';

        const isProspect = ROLES._idHasCode(user.id, 'PROSPECT');

        // Add message to sacrifice
        const sacrificeEmbed = COOP.MESSAGES.embed({ 
            title: 
                (isProspect ? `Prospect ` : '') +
                `${user.username}, you may be sacrificed${moodText}!`,
            description: 
                `**Decide <@${user.id}>'s fate**: React to choose! Dagger (remove) OR Shield (keep)!\n` +
                `\n**Member Stats:**\n` +
                `_Last message sent: ${lastMessageFmt}_\n` + 
                // `_Total messages sent: ${totalMsgsSent}_\n` +
                `_Total points: ${points}_\n` +
                `_Total items: ${totalItems}_`,
            thumbnail: COOP.USERS.avatar(user),
            footerText: 'The best Discord community to be sacrificed from!',
        });

        // Schedule end of message and reaction voting (24hr)
        const sacrificeMsg = await COOP.CHANNELS._postToChannelCode('ABOUT', sacrificeEmbed);
        TemporaryMessages.add(sacrificeMsg, sacrificeMsgLifetime, 'SACRIFICE');

        // Update the user's latest recorded sacrifice time.
        await COOP.USERS.updateField(user.id, 'last_sacrificed_secs', COOP.TIME._secs());

        // Add reactions for voting
        COOP.MESSAGES.delayReact(sacrificeMsg, EMOJIS.DAGGER, 1500);
        COOP.MESSAGES.delayReact(sacrificeMsg, EMOJIS.SACRIFICE_SHIELD, 2000);

        return true;
    }

    // Sacrifice random member if less than five people are being sacrificed and the member exists
    static async random() {
        try {
            // Select a member at random.
            const member = await COOP.USERS.random();

            // Access the sacrifice channel for sacrifice data.
            
            // const sacrificeChannel = COOP.CHANNELS._getCode('TALK');

            // TODO: Store in sacrifice table and load instead.

            // const sacrificeOffers = await sacrificeChannel.messages.fetch({ limit: 3 });

            // If space for another offer, offer one.
            // if (member && sacrificeOffers.size <= 3) 

            this.offer(member.user);

        } catch(e) {
            console.log('Error sacrificing random member!');
            console.error(e);
        }
    }

    // Last sacrifice time, last updated, how it works, current dagger/shield count.
    static async announce() {
        const sacrificeOffers = await this.loadOffers();
        const sacrifices = await Promise.all(sacrificeOffers.map(async offer => {
            const message = await MESSAGES.getByLink(offer.message_link);
            const desc = message.embeds[0].data.description;
            const discordID = /<@(\d*)>/.exec(desc)[1];

            const member = USERS._getMemberByID(discordID)

            return {
                sacrificee: member
            };
        }));

        console.log(sacrifices);

        // If there are sacrifices update the server about it.
        if (sacrifices.length > 0) {
            // const announceTitle = `**${EMOJIS.DAGGER}${EMOJIS.DAGGER} The Coop Sacrifice Ritual:**\n\n`;
            // const announceContent = announceTitle + 
            //     'Work in progress...\n\n' +
            //     'Add number of sacrifices ongoing and link to vote';
            // // await COOP.CHANNELS._send('TALK', announceContent);

            const msg = await COOP.CHANNELS._send('TALK', 'https://cdn.discordapp.com/attachments/902593785500946472/1056733990280765500/sacrifice-ritual.png');
            msg.edit({ 
                components: [
                new ActionRowBuilder().addComponents([
                    new ButtonBuilder()
                    .setEmoji('🗡')
                    .setLabel("Vote!")
                    .setURL(COOP.CHANNELS.link('ABOUT'))
                    .setStyle(ButtonStyle.Link),
                    new ButtonBuilder()
                        .setEmoji('📖')
                        .setLabel("Guide?")
                        .setURL("https://www.thecoop.group/guide/sacrifice")
                        .setStyle(ButtonStyle.Link)
                ])
            ] });




        }
    }
    
}