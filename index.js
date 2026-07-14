// ============================================================
// Aura PCs — Review Approval Bot
//
// What this does: watches the Discord channel where review submissions land.
// - React with ✅ to approve a review, it goes live on the site automatically.
// - React with 🗑️ to permanently delete a review, whether pending or live.
//
// The bot reads the review's own ID directly out of the Discord message's
// embed footer (put there by the website), so it never needs to look anything
// up in the database first — avoids an RLS edge case where pending rows
// aren't visible to the public API.
// ============================================================

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_USER_IDS = (process.env.OWNER_USER_IDS || "632797378147254283,804723860717043822").split(",");

if (!DISCORD_BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing required environment variables. Check SETUP.md.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}. Watching for review approvals.`);
});

client.on('messageReactionAdd', async (reaction, user) => {
  try {
    if (user.bot) return;
    if (!OWNER_USER_IDS.includes(user.id)) return;

    if (reaction.partial) {
      await reaction.fetch();
    }
    if (reaction.message.partial) {
      await reaction.message.fetch();
    }

    const emojiName = reaction.emoji.name;
    if (emojiName !== '✅' && emojiName !== '🗑️') return;

    const embed = reaction.message.embeds[0];
    if (!embed || !embed.footer || !embed.footer.text) return;

    const match = embed.footer.text.match(/Review ID: ([a-f0-9-]+)/i);
    if (!match) return;

    const reviewId = match[1];

    const { data: matches, error: findError } = await supabase
      .from('reviews')
      .select('id, approved, name')
      .eq('id', reviewId)
      .limit(1);

    if (findError) {
      console.error("Error looking up review:", findError.message);
      return;
    }
    if (!matches || matches.length === 0) return;

    const review = matches[0];

    if (emojiName === '✅') {
      if (review.approved) return;

      const { error: updateError } = await supabase
        .from('reviews')
        .update({ approved: true })
        .eq('id', review.id);

      if (updateError) {
        console.error("Error approving review:", updateError.message);
        return;
      }

      console.log(`Approved review from ${review.name} (id: ${review.id})`);
      try {
        await reaction.message.reply(`✅ Approved by ${user.username}. This review is now live on the site.`);
      } catch (replyErr) {
        console.warn("Couldn't post confirmation reply:", replyErr.message);
      }
      return;
    }

    if (emojiName === '🗑️') {
      const { error: deleteError } = await supabase
        .from('reviews')
        .delete()
        .eq('id', review.id);

      if (deleteError) {
        console.error("Error deleting review:", deleteError.message);
        return;
      }

      console.log(`Deleted review from ${review.name} (id: ${review.id})`);
      try {
        await reaction.message.reply(`🗑️ Deleted by ${user.username}. This review has been permanently removed.`);
      } catch (replyErr) {
        console.warn("Couldn't post confirmation reply:", replyErr.message);
      }
      return;
    }

  } catch (err) {
    console.error("Unexpected error handling reaction:", err);
  }
});

client.login(DISCORD_BOT_TOKEN);