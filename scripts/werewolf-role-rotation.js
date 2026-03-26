const werewolfEngine = require('../games/werewolfEngine');

const wolfRoles = ['werewolf', 'alphaWolf'];
const supportFillOrder = ['seer', 'doctor', 'bodyguard', 'witch', 'fool', 'mayor', 'revealer'];

function getRoleLabel(roleId) {
    const role = werewolfEngine.ROLE_DEFINITIONS[roleId];
    return role ? `${role.thaiName} (${roleId})` : roleId;
}

function buildThreePlayerRounds() {
    const configurableRoles = werewolfEngine.CONFIGURABLE_ROLE_IDS.filter(roleId => roleId !== 'villager');
    const uniqueSpecialRoles = configurableRoles.filter(roleId => !wolfRoles.includes(roleId));
    const rounds = [];
    let wolfIndex = 0;
    let specialIndex = 0;

    while (specialIndex < uniqueSpecialRoles.length) {
        const round = [wolfRoles[wolfIndex % wolfRoles.length]];
        wolfIndex += 1;

        while (round.length < 3 && specialIndex < uniqueSpecialRoles.length) {
            round.push(uniqueSpecialRoles[specialIndex]);
            specialIndex += 1;
        }

        while (round.length < 3) {
            const fillerRole = supportFillOrder.find(roleId => !round.includes(roleId)) || wolfRoles[wolfIndex % wolfRoles.length];
            round.push(fillerRole);
        }

        rounds.push(round);
    }

    return rounds;
}

function printPlan() {
    const rounds = buildThreePlayerRounds();

    console.log('Werewolf 3-player role rotation');
    console.log('');
    console.log('Use 3 browser sessions, create a 3-player room, then set exact roles in the lobby for each round below.');
    console.log('');

    rounds.forEach((round, index) => {
        console.log(`Round ${index + 1}:`);
        console.log(`  Role IDs   : ${round.join(', ')}`);
        console.log(`  Role names : ${round.map(getRoleLabel).join(' | ')}`);
        console.log('');
    });

    console.log('Lobby steps:');
    console.log('  1. Open the room lobby as admin.');
    console.log('  2. Expand the exact role selection section.');
    console.log('  3. Check only the 3 role IDs listed for the round.');
    console.log('  4. Save settings and start the game.');
    console.log('  5. Restart the room and move to the next round.');
}

printPlan();