/**
 * Every user-facing text the bot sends, in Armenian. Edit wording here only.
 * Messages are sent with parse_mode HTML, so values passed in must already be escaped
 * (see src/format.ts). Poll questions and options are plain text (no HTML).
 */

export const texts = {
  help: (o: { joinMinutes: number; reminderTime: string }) =>
    [
      'Բարև 👋 Ես Zema Games բոտն եմ, օգնում եմ գրասենյակում խաղ կազմակերպել 🎲',
      '',
      '<b>Հրամաններ</b>',
      '/play · սկսել նոր խաղ (նախ նշում ես, թե որ խաղերը կուզեիր)',
      '/play Azul · սկսել կոնկրետ խաղով (առանց քվեարկության)',
      '/games · մեր խաղերի ցանկը',
      '/cancel · ջնջել քո բաց հարցումը',
      '/help · այս հաղորդագրությունը',
      '',
      '<b>Ինչպես է աշխատում</b>',
      '1. /play-ից հետո նշում ես այն խաղերը, որոնք կուզեիր խաղալ, և սեղմում «✔️ Պատրաստ է»։',
      `2. Բոլորը ${o.joinMinutes} րոպե ունեն միանալու համար։ Հարցումը բացողը կարող է սեղմել «▶️ Սկսել հիմա»։`,
      '3. Նշված խաղերից մնում են նրանք, որոնք հարմար են մարդկանց քանակին (եթե մի քանիսն են, քվեարկում ենք)։',
      '4. Ես կանչում եմ թիմին, և գնում եք խաղալու 🚀',
      '',
      'Ամեն մեկը կարող է բացել իր հարցումը, բայց միաժամանակ միայն մեկը։ «🗑 Ջնջել» կոճակով ջնջում ես քոնը։',
      '',
      `Աշխատանքային օրերին ${o.reminderTime}-ին կհիշեցնեմ, որ դադարի ժամն է ☕`,
    ].join('\n'),

  playOnlyInGroup: 'Խաղերը սկսվում են Zema Games խմբում 🙂 Գրիր /play այնտեղ։',
  cancelOnlyInGroup: 'Խաղը կարելի է չեղարկել միայն Zema Games խմբում։',

  // Game picker (HTML message with buttons)
  pickerPrompt: (who: string, minutes: number) =>
    `${who}, ո՞ր խաղերը կուզեիր խաղալ 🎲 Նշիր մեկ կամ մի քանի խաղ և սեղմիր «✔️ Պատրաստ է» (${minutes} րոպե)`,
  pickerDoneButton: '✔️ Պատրաստ է',
  pickerForbidden: 'Խաղերն ընտրում է հարցումը բացողը 🙂 Քո հարցումը բացիր /play-ով',
  pickerEmpty: 'Նշիր գոնե մեկ խաղ 🙂',

  // Join poll (plain text)
  joinPollQuestion: (starter: string, games: string, minutes: number) =>
    `Խաղ է հավաքում՝ ${starter} 🎲 ${games}։ Ո՞վ է միանում (${minutes} րոպե)`,
  joinPollQuestionForGame: (starter: string, game: string, players: string, minutes: number) =>
    `Խաղ է հավաքում՝ ${starter} 🎲 ${game} (${players} հոգի)։ Ո՞վ է միանում (${minutes} րոպե)`,
  joinOptionYes: 'Ես խաղում եմ 🙋',
  joinOptionNo: 'Այս անգամ՝ ոչ',

  startNowButton: '▶️ Սկսել հիմա',
  startNowStarted: 'Սկսում ենք 🚀',
  startNowTooFew: (min: number) => `Դեռ քիչ ենք 🙂 Պետք է առնվազն ${min} հոգի`,

  gameNotFound: (names: string) => `Այդպիսի խաղ չգտա 🤔 Ընտրիր սրանցից՝ ${names}`,
  gameAmbiguous: (names: string) => `Մի քանի խաղ է համապատասխանում՝ ${names}։ Գրիր ավելի ճշգրիտ 🙂`,
  tooFewForGame: (game: string, min: number, joined: number) =>
    `${game}-ի համար պետք է առնվազն ${min} հոգի, իսկ միացել է ${joined}-ը 😅 Խաղը չեղարկվեց, փորձեք մեկ այլ խաղ կամ /play`,
  splitIntroForGame: (game: string, players: number, max: number) =>
    `Վա՜յ, ${players} հոգի ենք 🎉 ${game}-ը մինչև ${max} հոգու համար է, բաժանվենք խմբերի՝`,
  startNowForbidden: 'Սկսել կարող է միայն հարցումը բացողը 🙂',
  startNowClosed: 'Այս հարցումն արդեն փակված է',

  deleteButton: '🗑 Ջնջել',
  deleted: 'Հարցումը ջնջվեց 🗑',
  deleteForbidden: 'Ջնջել կարող է միայն հարցումը բացողը կամ ադմինը 🙂',

  ownSessionExists: (who: string) => `${who}, դու արդեն բաց հարցում ունես 👆 Ջնջե՞լ այն և բացել նորը։`,
  replaceButton: '🗑 Ջնջել և բացել նորը',
  keepButton: 'Թողնել',
  notYours: 'Սա քո հարցումը չէ 🙂',
  callbackOwnActive: 'Դու արդեն բաց հարցում ունես 👆',
  callbackStarted: 'Ընտրիր խաղերը 🎲',

  tooFew: (min: number) => `Այս անգամ չհավաքվեցինք 😅 Պետք է առնվազն ${min} հոգի։ Հաջորդ անգամ անպայման 💪`,

  singleGame: (players: number, game: string) =>
    `${players} հոգու համար ամենահարմարը մեկ խաղ է՝ <b>${game}</b> 👌`,

  // Game poll (plain text)
  gamePollQuestion: (players: number, minutes: number) =>
    `Ի՞նչ ենք խաղում (${players} հոգի) 🗳 Քվեարկությունը՝ ${minutes} րոպե`,

  voteWinner: (game: string) => `Քվեարկությամբ հաղթեց <b>${game}</b>-ը 🎉`,
  voteTie: (tied: string, game: string) =>
    `Ձայները հավասար բաժանվեցին (${tied}), ես պատահականորեն ընտրեցի՝ <b>${game}</b> 🎲`,

  teamReady: (o: { game: string; mentions: string; link?: string }) =>
    [
      `🎮 <b>${o.game}</b>`,
      `Թիմը պատրաստ է՝ ${o.mentions}`,
      ...(o.link ? [`Հղումը՝ ${o.link}`] : []),
      'Գնացինք խաղալու 🚀',
    ].join('\n'),

  splitIntro: (players: number) =>
    `Վա՜յ, ${players} հոգի ենք 🎉 Ոչ մի խաղ այսքան մարդու համար չէ, առաջարկում եմ բաժանվել խմբերի՝`,
  splitGroup: (o: { index: number; size: number; mentions: string; games: string }) =>
    `<b>Խումբ ${o.index}</b> (${o.size} հոգի)՝ ${o.mentions}\nԽաղեր՝ ${o.games}`,
  splitOutro: 'Թիմերը պատրաստ են, գնացինք խաղալու 🚀',

  noPickedFit: (players: number, games: string, mentions: string) =>
    `${players} հոգու համար նշված խաղերից ոչ մեկը չի համապատասխանում 🤔 Բայց կարող եք խաղալ՝ ${games}։ ${mentions}`,
  noFit: (players: number, mentions: string) =>
    `${players} հոգու համար հարմար խաղ չգտա 🤔 Նայեք /games ցանկը և ընտրեք ինքներդ՝ ${mentions}`,

  cancelled: (by: string) => `Հարցումը ջնջվեց 🗑 Ջնջեց՝ ${by}`,
  noOwnSession: 'Դու բաց հարցում չունես։ Սկսիր /play-ով 🎲',

  gamesHeader: '🎲 <b>Մեր խաղերը</b>',
  gameLine: (o: { name: string; kind: string; players: string; minutes: string; description: string; link?: string }) =>
    [
      `• <b>${o.name}</b> (${o.kind}) · ${o.players} հոգի · ~${o.minutes} րոպե`,
      `  ${o.description}`,
      ...(o.link ? [`  ${o.link}`] : []),
    ].join('\n'),
  gameKind: { physical: 'սեղանի', online: 'օնլայն' } as const,

  reminders: [
    '☕ Լանչը վերջացավ, ժամանակն է մի քիչ շունչ քաշել։ Ո՞վ է խաղում',
    '🧩 Կոդը չի փախչի, իսկ լավ խաղը սպասում է։ Մի կարճ խաղ անե՞նք',
    '😺 Exploding Kittens-ը կարոտել է ձեզ։ 15 րոպե խաղ, ու նոր ուժերով առաջ',
    '🚀 Փոքր դադար, մեծ էներգիա։ Եկեք մի խաղ անենք',
    '🎯 Դադարի ժամն է՝ մի քիչ հանգստանանք ու մրցենք։ Ո՞վ է պատրաստ',
    '🎲 Ուղեղին էլ է հանգիստ պետք։ Հավաքվում ենք խաղալու',
  ],
  reminderButton: '🎲 Սկսել խաղը',

  commands: {
    play: 'Սկսել նոր խաղ',
    games: 'Խաղերի ցանկը',
    cancel: 'Ջնջել քո բաց հարցումը',
    help: 'Ինչպես օգտվել բոտից',
  },
} as const;
