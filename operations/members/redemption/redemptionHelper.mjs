import VotingHelper from "../../activity/redemption/votingHelper.mjs";

import COOP, { STATE, CHANNELS, MESSAGES } from "../../../coop.mjs";
import { RAW_EMOJIS, ROLES, CHANNELS as CHANNELS_CONFIG } from 'coop-shared/config.mjs';
import { ButtonStyle, ActionRowBuilder, ButtonBuilder } from "discord.js";


export const STARTING_ROLES = [
    'MEMBER', 'BEGINNER', 'SUBSCRIBER', 'SOCIAL',
    'PROSPECT', 'PROJECTS'
];

export default class RedemptionHelper {

    static announce() {
        console.log('Announce pending intros');
    }

    static async onReaction(reaction, user) {
        const emoji = reaction.emoji.name;
        const isVoteEmoji = [RAW_EMOJIS.VOTE_FOR, RAW_EMOJIS.VOTE_AGAINST].indexOf(emoji) > -1;
        const channelID = reaction.message.channel.id;

        if (user.bot) return false;
        if (!isVoteEmoji) return false;
        if (channelID !== CHANNELS_CONFIG.INTRO.id) return false;

        // Process the vote
        this.processVote(reaction, user);
    }

    static async processVote(reaction, user) {
        const targetUser = reaction.message.author;

        let forVotes = 0;
        let againstVotes = 0;

        try {
            const voterMember = COOP.USERS._getMemberByID(user.id);
            const targetMember = COOP.USERS._getMemberByID(targetUser.id);

            // If member left, don't do anything.
            if (!targetMember) return false;
            
            // If targetMember has "member" role, don't do anything.
            if (COOP.USERS.hasRoleID(targetMember, ROLES.MEMBER.id)) return false;

            // Prevent PROSPECTS from letting people in.
            if (COOP.ROLES._idHasCode(user.id, 'PROSPECT')) {
                reaction.users.remove(user.id);
                return COOP.MESSAGES.selfDestruct(reaction.message, `${user.username} you can't vote as a PROSPECT. :dagger:`);
            }

            // Calculate the number of required votes for the redemption poll.
            const reqForVotes = VotingHelper.getNumRequired(.025);
            const reqAgainstVotes = VotingHelper.getNumRequired(.015);
            
            // TODO: Refactor into a reaction guard! :D
            // Remove invalid reactions.
            if (!COOP.USERS.hasRoleID(voterMember, ROLES.MEMBER.id))
                return await reaction.users.remove(user.id);

            // Get existing reactions on message.
            reaction.message.reactions.cache.map(reactionType => {
                if (reactionType.emoji.name === RAW_EMOJIS.VOTE_FOR) 
                    forVotes = Math.max(0, reactionType.count - 1);

                if (reactionType.emoji.name === RAW_EMOJIS.VOTE_AGAINST) 
                    againstVotes = Math.max(0, reactionType.count - 1);
            });

            const votes = { for: forVotes, against: againstVotes };

            // Handle user approved.
            if (forVotes >= reqForVotes) {
                this.approve(targetMember, reaction, votes);

            // TODO: Refactor to reject method
            // Handle user rejected.
            } else if (againstVotes >= reqAgainstVotes) {
                // Inform community.
                COOP.CHANNELS._codes(['TALK'], `${targetUser.username} was voted out, removed and banned. Ouch.`);

                // Inform the user.
                try {
                    targetMember.send('You were voted out of The Coop.');
                } catch(e) {
                    console.log('Failed to inform user via DM of their removal.', targetUser);
                    console.error(e);
                }

                // TODO: List current leaders/command for contact in order to appeal.
                await targetMember.ban();

            } else {
                const votingStatusTitle = `**<@${targetUser.id}>'s entry was voted upon!**`;
                const votingStatusText = votingStatusTitle +
                    `\n# Votes still required: ` +
                    `Entry ${RAW_EMOJIS.VOTE_FOR}: ${Math.max(0, reqForVotes - forVotes)} | ` +
                    `Removal ${RAW_EMOJIS.VOTE_AGAINST}: ${Math.max(0, reqAgainstVotes - againstVotes)}`;

                // Track whether to post an sacrifice info message or update existing one.
                let updatingMsgInstead = false;

                // Check if the message is already within the past 5 feed messages (if so update it and reduce spam).
                // TODO: This way of preventing certain kinds of feedback spam should be refactored and reused everywhere.
                const feed = COOP.CHANNELS._getCode('TALK');
                const latestMsgs = await feed.messages.fetch({ limit: 10 });
                latestMsgs.map(m => {
                    if (m.content.includes(votingStatusTitle)) {
                        m.edit(votingStatusText);
                        updatingMsgInstead = true;
                    }
                });

                // Provide feedback for user who is not currently protected or sacrificed.
                if (!updatingMsgInstead)
                    COOP.CHANNELS._send('TALK', votingStatusText);
            }
                
        } catch(e) {
            console.log('Approval failed.');
            console.error(e);

            // Catch cannot send to user and notify them in approval channel, Cooper is HIGHLY recommended. ;)
        }
    }

    static handleNewbOutstayedWelcome(member) {
        // Remove all users without member role that have been here for more than 3 days.
        const hasRole = COOP.ROLES._has(member, 'MEMBER');
        const stayDurationSecs = (Date.now() - member.joinedTimestamp) / 1000;
        const stayDurationHours = stayDurationSecs / 3600;
        const stayDurationDays = stayDurationHours / 24;
        if (stayDurationDays > 3 && !hasRole) {
            const banReason = `${member.user.username} banned due to not being approved within 3 days.`;
            CHANNELS._postToChannelCode('TALK', banReason)
            member.ban({ days: 7, reason: banReason });
        }
    }

    static async approve(targetMember, reaction, votes) {
        // Add to database if not already in it.
        const savedUser = await COOP.USERS.loadSingle(targetMember.user.id);
        if (!savedUser) {
            await COOP.USERS.addToDatabase(
                targetMember.user.id, 
                targetMember.user.username, 
                targetMember.joinedDate,
                reaction.message.createdTimestamp,
                MESSAGES.link(reaction.message),

                // TODO: Sanitise.
                reaction.message.content
            );
        }

        // Inform the user.
        try {
            // TODO: Improve welcome text message to be more informative and prettier.
            targetMember.send('Thank you for joining, we value your presence! You were voted into The Coop and now have **full access**!');
        } catch(e) {
            console.log('Failed to inform user via DM of their removal.', targetMember.user);
            console.error(e);
        }

        // Give intro roles
        await COOP.ROLES._addCodes(targetMember.user.id, STARTING_ROLES);

        // Check message for roles that may match their interests.
        const roleMatches = {
            MONEY: ['stocks', 'finance', 'business', 'invest', 'gambl'],
            ART: ['painting', 'drawing', '3d modelling', 'game', 'design'],
            TECH: ['coding', 'program', 'tech', 'dev', 'game design'],
        }

        // Check 
        const desiredRoles = Object.keys(roleMatches).filter(roleKey => {
            const roleMatches = roleMatches[roleKey].some(roleWord => reaction.message.content.includes(roleWord));
            return roleMatches
        });

        COOP.CHANNELS._send('TALK', 'Could have added desired roles', desiredRoles, reaction.message.content);

        // Inform community.
        const msg = await COOP.CHANNELS._send('TALK', 
            `**<@${targetMember.user.id}> democratically approved into the community!** !\n` +
            `${votes.for ? `\n${RAW_EMOJIS.VOTE_FOR.repeat(votes.for)}` : ''}` +
            `${votes.against ? `\n${RAW_EMOJIS.VOTE_AGAINST.repeat(votes.against)}` : ''}`
        );

        const rolesLoginLink = 'https://discord.com/api/oauth2/authorize?method=discord_oauth&client_id=799695179623432222' +
            "&redirect_uri=https%3A%2F%2Fthecoop.group%2Fauth%2Fauthorise&response_type=code&scope=identify&state=roles";

        msg.edit({ components: [
            new ActionRowBuilder()
                .addComponents([
                    new ButtonBuilder()
                        .setLabel("Profile")
                        .setEmoji('👤')
                        .setURL('https://www.thecoop.group/members/' + targetMember.user.id)
                        .setStyle(ButtonStyle.Link),
                    new ButtonBuilder()
                        .setLabel("Edit Roles")
                        .setEmoji('⚙️')
                        .setURL(rolesLoginLink)
                        .setStyle(ButtonStyle.Link)
                ])
        ] });
    }

}