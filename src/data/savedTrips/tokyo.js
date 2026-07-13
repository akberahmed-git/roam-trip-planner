// A real, pre-captured result from /api/generate-resolved-itinerary for a
// 2-day Tokyo trip - same shape the live endpoint returns ({ packed, slow }),
// with every place already Places-verified and every travel time already
// computed via Google Routes. Captured once ahead of time rather than
// generated live, but not fabricated: this is the actual output of a real
// run through the real pipeline (Claude draft -> Places verification ->
// Routes travel times), just saved instead of thrown away.

export const TOKYO_2_DAYS = {
  "packed": {
    "label": "Packed & Varied",
    "tagline": "Fast-paced exploration across diverse Tokyo districts",
    "divergenceLabel": "This itinerary maximizes experiences with multiple neighborhoods and activities each day, offering a whirlwind tour of Tokyo's highlights.",
    "days": [
      {
        "day": 1,
        "theme": "Traditional Tokyo & Modern Shibuya",
        "items": [
          {
            "time": "breakfast",
            "type": "meal",
            "name": "Fish Market Tsukiji Outer Market",
            "categoryTag": "Market · Culinary",
            "description": "Fresh sushi and street food at the famous market.",
            "startTime": "08:00",
            "durationMinutes": 60,
            "mealType": "breakfast",
            "address": "Japan, 〒104-0045 Tokyo, Chuo City, Tsukiji, 4-chōme−16 および６丁目一部",
            "rating": 4.2,
            "ratingCount": 55808,
            "photoUrl": "/api/place-photo?ref=places%2FChIJW2cLzSGLGGARXAKXv6EkbqI%2Fphotos%2FAaVGc3k89rMeB1iSgIWLxxJHA6uCa5pA0niKFgazzA_bgD31ytp5Bmgmg8HTQl4rs3jKvVr68CCa6HxTM_TQwj-t0oCl7xgtBGPVTM4kuFKrz0y37p2dhdAQcob0Ttc-KFf9K9a24dX2TUh7M8cN18FLrnCVdSb8MwAyDuYfF1F19NcdEI1X2Adlwk55kfINq4VfBGK6z7ulAesk5J4tudafC9V9qbndNSL5gkoRCKD397Sd15D191X1QiCeg4LwTsFY7XhnbcRwnj2Zc48ZNPTBX4LkAvGl4r5dAZjC617TuAaWdmQb0bskrj0VR3UXZsUG0_nFy8wwIyAkw_kZwOGJAGWfN0Vju4bgwLX7v-GhDXMohg9e8LOdgKvElScE__7hd3wtmHB7hYQ26naGX2ElvZTcV5NpuIG3RZedDwW0jki5bw",
            "hasHours": false,
            "weekdayDescriptions": null,
            "location": {
              "lat": 35.6647703,
              "lng": 139.7702515
            },
            "travelToNext": "18 minute drive"
          },
          {
            "time": "morning",
            "type": "activity",
            "name": "Sensō-ji",
            "categoryTag": "Temple · Historic",
            "description": "Tokyo's oldest Buddhist temple in Asakusa.",
            "startTime": "09:30",
            "durationMinutes": 90,
            "mealType": null,
            "address": "2-chōme-3-1 Asakusa, Taito City, Tokyo 111-0032, Japan",
            "rating": 4.6,
            "ratingCount": 96645,
            "photoUrl": "/api/place-photo?ref=places%2FChIJ8T1GpMGOGGARDYGSgpooDWw%2Fphotos%2FAaVGc3mXK1wddg9tRRXsjsTRoakYmEod4aEbHqx9datVE3w8iTb2K5H--4O26-Muro02f4J2eaYNzRa_7Q-H-G72offQxyreb72anRrupghZgpgG62K8EJPZh1h7-HwGa8j_aizAnPgY9s5RIP6vtxAFNiObDCtj4O2sdLq7udw58SfzNI2FamerYmV-2924nl9SUPZHXNXaTINmbdoyskIZ0MrM6DroOdmBDU6js3GKGCyBEJRAhq-KZ22w1zBBHkt1OBvTSCWOkEWEQFqke3By5-Fyp0VwRkP-nRujN4eB6Vjvj2TnMFBMMKaSLwJdyyirPy7vLZtPaYUVv4tF0jh6CzNR1hJsI8nCwErnsFNH7xjc4NzhxSQKJReUrCaMLdwB-yqdpELNGcI5egHZPEstaLfhhP1RPC87_QR6KKU4WGASTQ7R",
            "hasHours": false,
            "weekdayDescriptions": null,
            "location": {
              "lat": 35.7147651,
              "lng": 139.7966553
            },
            "travelToNext": "25 minute walk"
          },
          {
            "time": "midday",
            "type": "activity",
            "name": "Tokyo Skytree",
            "categoryTag": "Tower · Landmark",
            "description": "Panoramic city views from Japan's tallest structure.",
            "startTime": "11:30",
            "durationMinutes": 75,
            "mealType": null,
            "address": "1-chōme-1-2 Oshiage, Sumida City, Tokyo 131-0045, Japan",
            "rating": 4.4,
            "ratingCount": 116612,
            "photoUrl": "/api/place-photo?ref=places%2FChIJ35ov0dCOGGARKvdDH7NPHX0%2Fphotos%2FAaVGc3ntBi0E4ysVGSFR8kyJ59Pjx2AYYsyT6hzjI0YHJ8J_d3F9mmV0oz8mwbPElQnBnk7OiLk0tJ5M3vmqZ9gXlYBXxyJzQjHBAbP8tCiUIg7uhmY1H1jFWPXE0WdWSUTNmUMoXQZVGmEAvFPBA315bzOH4NYxPxHMbW30dCzarXqtKUPRbkzEUOKXEcYXFc1vxFS_XM08CcYf7CxGONgT1pCqfVGZG9R0jlkIbYi6_3Iap2b3PeeGW6rBVcF106sELcMNagzio4cnZVetCJB3gwwzAR_DT7cFodIUYtxnyVAI-EpAUFyCMsQSxFobFGcwgJK6uKiA9uQV-IsSw0petXxNdRO9vCZmG1oeb34-LHfxjFRoKRcOgyssjiuVypMYqTgrMeRQMtqCSmfQo8Mu9My8-J_lQqN4e-cm8pMG4jux-bA",
            "hasHours": true,
            "weekdayDescriptions": [
              "Monday: 10:00 AM – 10:00 PM",
              "Tuesday: 10:00 AM – 10:00 PM",
              "Wednesday: 10:00 AM – 10:00 PM",
              "Thursday: 10:00 AM – 10:00 PM",
              "Friday: 10:00 AM – 10:00 PM",
              "Saturday: 9:00 AM – 10:00 PM",
              "Sunday: 9:00 AM – 10:00 PM"
            ],
            "location": {
              "lat": 35.7100627,
              "lng": 139.81070040000003
            },
            "travelToNext": "30 minute drive"
          },
          {
            "time": "lunch",
            "type": "meal",
            "name": "Afuri Karakurenai Harajuku",
            "categoryTag": "Restaurant · Casual",
            "description": "Light yuzu-infused ramen near Harajuku.",
            "startTime": "13:00",
            "durationMinutes": 50,
            "mealType": "lunch",
            "address": "Japan, 〒150-0001 Tokyo, Shibuya, Jingūmae, 4-chōme−29−９ Onden, AFURI辛紅",
            "rating": 4.9,
            "ratingCount": 4589,
            "photoUrl": "/api/place-photo?ref=places%2FChIJIwNTvbGNGGARO9IK6sxdxsQ%2Fphotos%2FAaVGc3lddL-pPSTKKJqERJYQ7lcKR6pysAcpNuROSzCnEJi_k9VLsMv0hA-eK9HTgifGDqFTPxadzRsfuTJG_M-l9IDHimiBavXdTrNgLzIP6MRU5u2z92Q4WVBkWHcrBN3HoGzIWH1ugODkYV78F5nG5Zjst28kwFxpMmqOVOGFcWfmroAiQPgItcJghBbm5DmGFDwREi9pY2HADCtsRhQaznTBQZpEfY15FCO6Y-_T59h3kdLQ97BZiCxe8XCOurmPDUl-xHp6oMLmFrsKGbIWfKIxd6w90AkZHpdDgnwgH1S0ZxAjqZGpRGQflsvyP9lAI1eBpb37QuORtr-VgYHl6IdIlc1nLukBcNijAcBKcK2_DFhae-im8FbP1dbB9J0IqbBtlrFqLny0RZJEFFUzy9sk39XLt1sTgCE1Klku5rz7cQ",
            "hasHours": true,
            "weekdayDescriptions": [
              "Monday: 11:00 AM – 10:00 PM",
              "Tuesday: 11:00 AM – 10:00 PM",
              "Wednesday: 11:00 AM – 10:00 PM",
              "Thursday: 11:00 AM – 10:00 PM",
              "Friday: 11:00 AM – 10:00 PM",
              "Saturday: 11:00 AM – 10:00 PM",
              "Sunday: 11:00 AM – 10:00 PM"
            ],
            "location": {
              "lat": 35.66844,
              "lng": 139.70656449999998
            },
            "travelToNext": "22 minute walk"
          },
          {
            "time": "afternoon",
            "type": "activity",
            "name": "Meiji Jingu",
            "categoryTag": "Shrine · Nature",
            "description": "Tranquil Shinto shrine in forested grounds.",
            "startTime": "14:15",
            "durationMinutes": 60,
            "mealType": null,
            "address": "1-1 Yoyogikamizonochō, Shibuya, Tokyo 151-8557, Japan",
            "rating": 4.6,
            "ratingCount": 51477,
            "photoUrl": "/api/place-photo?ref=places%2FChIJ5SZMmreMGGARcz8QSTiJyo8%2Fphotos%2FAaVGc3mT9iCwOCDqEsLG4gBDi5dB7045CNT0NFahWqtvi6lNc-R-zcehiWYL5QO_2hEhUNWwF7lG5HXz9tiydrMjS2rJpp2wU8b0l1gA_zaG51r2k7Uq_yfsFFKOn96a8MZotxcJiGgPolbXchU4FZVoiCo8knLkNZAh0dBr_3m9i082BSp7wpRphynjF0nB9qJC0xufQUB2M3BHnw73bWPXpW9498OAU7RksHdgm_zaO3_uqLZbzHRjiDycc8SVqLvninTChd4kbi0zHYWvTOGabAU4f8CC_Ots4jklSeWflmgLB4bdQ6kSn2Kd0ypLwp1TOmhDR_MT175g6C6LMxg8v3yqhUEeThfdqbeS4Ah8vRvdHRQToT_M30bl6ucHxl8njYD2VRD6nW3fzA4LWu1I5KxDfYObMxKWAQzEFS-8wEQluWea",
            "hasHours": false,
            "weekdayDescriptions": null,
            "location": {
              "lat": 35.6763976,
              "lng": 139.6993259
            },
            "travelToNext": "7 minute drive"
          },
          {
            "time": "late afternoon",
            "type": "activity",
            "name": "Shibuya Crossing",
            "categoryTag": "Landmark · Urban",
            "description": "Experience the world's busiest pedestrian intersection.",
            "startTime": "15:45",
            "durationMinutes": 45,
            "mealType": null,
            "address": "21 Udagawacho, Shibuya, Tokyo 150-0042, Japan",
            "rating": 4.5,
            "ratingCount": 22544,
            "photoUrl": "/api/place-photo?ref=places%2FChIJK9EM68qLGGARacmu4KJj5SA%2Fphotos%2FAaVGc3mr4lxCYL5K_s2-EMB_XBfg60-ibAxdoV7f3k2zEaZpd9_aTCluXBNCq7CH-n8i-3nSr9lV5YIOIqIt-1bqY1tHFUJT_HIUK5oTXO4K5Fnc1_aL4AKa7rr00oFd_-OW_9rZbhs6OKecIbSC3jAglE7p5loD5XWAWb5c0cXjD5o_quMkkabf9QgLlWZk4grX5sfXqJlPYC8Y-9Q5gLpYMxdsG0HHOV6uZqcKGPHpt5pGttKkutnFUm06vUxFUFWcaJKDkEUdN5W8fYSO7EdMnfCJbmZ0pi5DvjS_DOqJTUbyzaQf5YB1OBi1_eg2G9F8OaQM40NbtztYBDWHphbBk-VwFaH5PW7X1jj9ftXhTQL4u3saFTAZmMTusy75fjGDqn_DdJKJEGzpjkixSxLG5qqPmaBtddZJ7xABoQlyGVuN8B8",
            "hasHours": false,
            "weekdayDescriptions": null,
            "location": {
              "lat": 35.659482,
              "lng": 139.7005596
            },
            "travelToNext": "10 minute walk"
          },
          {
            "time": "dinner",
            "type": "meal",
            "name": "Gonpachi Shibuya",
            "categoryTag": "Restaurant · Traditional",
            "description": "Izakaya-style dining with yakitori and atmosphere.",
            "startTime": "19:00",
            "durationMinutes": 90,
            "mealType": "dinner",
            "address": "Japan, 〒150-0044 Tokyo, Shibuya, Maruyamachō, 3−６ E-Space Tower, １４Ｆ フロアA",
            "rating": 4.2,
            "ratingCount": 2152,
            "photoUrl": "/api/place-photo?ref=places%2FChIJ3TUL91WLGGARNQVCAWLb0kw%2Fphotos%2FAaVGc3nXC7n_GqdlX6lS0NQjW5jtucKfsoqr-asLaZm1QvhwvuOZp2_X9VNmeEdxXrDLqu8EBF0300Dz7Zl2HROt26Agjv3uwSs3PCV8x25wAVxkI7EEoxCiUCLk5X9UmsM9uKebE-hqNP6EhyEAaBVB4hL3fRHCR1o29Qj8jPR0UQc3b_LbACdlyZhiPi0ODPEVkeLt5bEIclH7rQNttWDb25eVE8OmJk4_LJmANC3ibqOMlLI0Py4DRLxaNSXl3EaBSoHSlfhYzqh0WZQYdPoklR-PZNPmsKYpssETUXq9QyzQYQEnsoJlaTxSl4e0e0OE7CwF4pVR0mVmudTTGuRpqOkldWUBS5g02tWCVVyz9Zwph8OYcbXubn9_hISaaWdM1VFkyBXeoaNnC5EhuEmLXFWQkiZJoywPzAL-25CQZnuRMg",
            "hasHours": true,
            "weekdayDescriptions": [
              "Monday: 11:30 AM – 3:30 AM",
              "Tuesday: 11:30 AM – 3:30 AM",
              "Wednesday: 11:30 AM – 3:30 AM",
              "Thursday: 11:30 AM – 3:30 AM",
              "Friday: 11:30 AM – 3:30 AM",
              "Saturday: 11:30 AM – 3:30 AM",
              "Sunday: 11:30 AM – 3:30 AM"
            ],
            "location": {
              "lat": 35.6574935,
              "lng": 139.6955514
            },
            "travelToNext": null
          }
        ],
        "stopCount": 7,
        "pacingLevel": 0.88
      },
      {
        "day": 2,
        "theme": "Imperial Tokyo & Electronics District",
        "items": [
          {
            "time": "breakfast",
            "type": "meal",
            "name": "bills Omotesando",
            "categoryTag": "Cafe · Contemporary",
            "description": "Famous ricotta pancakes and Australian brunch.",
            "startTime": "08:30",
            "durationMinutes": 60,
            "mealType": "breakfast",
            "address": "Japan, 〒150-0001 Tokyo, Shibuya, Jingūmae, 4-chōme−30−３ 東急プラザ 表参道原宿 7F",
            "rating": 4,
            "ratingCount": 3497,
            "photoUrl": "/api/place-photo?ref=places%2FChIJoQC4faSMGGAR1wiDmBUhsAs%2Fphotos%2FAaVGc3lqTyaeQuJsFgyQkImLAIlNnqPqpqP5jduodztpuodzBbFXW9r851r3vymGAN_uhZ788U_dCMAYl3HG3cxEXlbYea9S1zbCgA2miATI817p-tAVdQy58L3oxLTi6mP4sYByFkQdQR-8MnTihsGXuccORZmnCmI9koP5LwM4OO3XVD9Ww8qild0pjQ7b_StsyuvVxZon-o7UMpOeUQTCjZgQQ2vAIyjkfzyFVaj6-jGFeINWp-pmoZRpvcVZLxkEFLzic_VXTX-FSh2tQl7kVHF6WPO_QxMGJiWcN3UDFv1NiTxZgxZr-hechskyNPhgpL74mL03bqArb9yDc9_EKVPqqHOHxgNyKyrhL3MUnfVRNAETwW8UCyi5aeEokLCMk9aoan2SC9Zv3hae9cVHyRlIRCZF_t6Cg0X36J0knZuHBGW8",
            "hasHours": true,
            "weekdayDescriptions": [
              "Monday: 8:30 AM – 10:00 PM",
              "Tuesday: 8:30 AM – 10:00 PM",
              "Wednesday: 8:30 AM – 10:00 PM",
              "Thursday: 8:30 AM – 10:00 PM",
              "Friday: 8:30 AM – 10:00 PM",
              "Saturday: 8:30 AM – 10:00 PM",
              "Sunday: 8:30 AM – 10:00 PM"
            ],
            "location": {
              "lat": 35.6685817,
              "lng": 139.7057812
            },
            "travelToNext": "16 minute drive"
          },
          {
            "time": "morning",
            "type": "activity",
            "name": "Imperial Palace East National Gardens",
            "categoryTag": "Garden · Historic",
            "description": "Beautiful gardens on former Edo Castle grounds.",
            "startTime": "10:00",
            "durationMinutes": 90,
            "mealType": null,
            "address": "1-1 Chiyoda, Chiyoda City, Tokyo 100-8111, Japan",
            "rating": 4.4,
            "ratingCount": 10139,
            "photoUrl": "/api/place-photo?ref=places%2FChIJPfFaQhOMGGAR-QPbNQoAG6M%2Fphotos%2FAaVGc3k7xql1CaGIZeHMPIdPwjQqjYudK4DsQHL0v8K7gXZXXzjKWUti9loYiwYoB6ygT4WQb0lEogWDM9bf6Aks6dmEGeF4omvw2o4ZbMey1YaBOvwCHf-aqaSZxhpG3kHHLnRSXyXR8tnFGve_GmwzXyFgEFEitFRbtFmmzaIJPW8pD4kDPrLWzEY8GrAB2HAeCcHtDefs82LFwL_vvTFANM_ZIm2HFAe3CoBiTlqNXCDt62tO6DbCHLktGRVIFZf4QB1AVqTZEwqoOitdjzDDutzu0yhVtMlAxcYy9RwAIMFfNligcA2QcdsEt9SX4ePCHpNB6yt5Jil5c4XJnkEpEE6Oh0v4JgfYn4wuWmEX1pLWzszCSiVhofmaiJLrpw-oziQ8zWA554IWHxOYpVRpaJmDbP88XTorklHHdlq022PBrnO2",
            "hasHours": true,
            "weekdayDescriptions": [
              "Monday: Closed",
              "Tuesday: 9:00 AM – 6:00 PM",
              "Wednesday: 9:00 AM – 6:00 PM",
              "Thursday: 9:00 AM – 6:00 PM",
              "Friday: Closed",
              "Saturday: 9:00 AM – 6:00 PM",
              "Sunday: 9:00 AM – 6:00 PM"
            ],
            "location": {
              "lat": 35.6867824,
              "lng": 139.75714449999998
            },
            "travelToNext": "16 minute drive"
          },
          {
            "time": "midday",
            "type": "activity",
            "name": "teamLab Borderless: MORI Building DIGITAL ART MUSEUM",
            "categoryTag": "Museum · Digital",
            "description": "Immersive digital art installation experience.",
            "startTime": "12:00",
            "durationMinutes": 120,
            "mealType": null,
            "address": "Japan, 〒106-0041 Tokyo, Minato City, Toranomon, 5-chōme−9−９ Azabudai Hills Garden Plaza B, B1",
            "rating": 4.6,
            "ratingCount": 28970,
            "photoUrl": "/api/place-photo?ref=places%2FChIJQ5Sa1PqJGGARUSaNKKOrMVg%2Fphotos%2FAaVGc3nlOD6Fn5wVwv8WaVm800SrSwEvNMZKzq7iMst9yDileEgj0SQc-6weO4ZbN7dFplzr-SQ7WvAgSrLXry5LjsWoNx47pkSTfiPWKHIA06hstT6OclWftvZySmf1YvaASkFJ8AdKFOIw6Tkt17Be5vLDo0LO6c_jqL5RxQi0dH2FCVmlv3hMemkQsKRLoaghuvxk9pqxEUrRgqWP5YH45dfWeHfhG0pIhBXPLenfyrCyzrfp24n72S19Bc_vyRyNsoU2LE0DhANA9OLxhLuyrswzOItxghC9UrXL_B7uowOKQxCTkBp0u0mJDv4RDzi7i9Rzl7Cz5CubPtH7kZSnh5GH8c95jtmg8bt-zZyw75LRWE_cs-wEt8-hvQ2w1bAk7twHp82_LWfbuERJn8vTAj0MIvdXM-JC5dpjlob_V-L8Bw",
            "hasHours": true,
            "weekdayDescriptions": [
              "Monday: 8:30 AM – 9:00 PM",
              "Tuesday: 8:30 AM – 9:00 PM",
              "Wednesday: 8:30 AM – 9:00 PM",
              "Thursday: 8:30 AM – 9:00 PM",
              "Friday: 8:30 AM – 9:00 PM",
              "Saturday: 8:30 AM – 9:00 PM",
              "Sunday: 8:30 AM – 9:00 PM"
            ],
            "location": {
              "lat": 35.6620689,
              "lng": 139.7432671
            },
            "travelToNext": "18 minute drive"
          },
          {
            "time": "lunch",
            "type": "meal",
            "name": "ICHIRAN Shibuya Spain-zaka",
            "categoryTag": "Restaurant · Ramen",
            "description": "Solo booth tonkotsu ramen experience.",
            "startTime": "14:30",
            "durationMinutes": 40,
            "mealType": "lunch",
            "address": "Japan, 〒150-0042 Tokyo, Shibuya, Udagawachō, 13−７ コヤスワン B1F",
            "rating": 4.4,
            "ratingCount": 2804,
            "photoUrl": "/api/place-photo?ref=places%2FChIJfQVxq6mMGGARK0zIBxe0-Dw%2Fphotos%2FAaVGc3kg0ZWVUUL71bZ8VBpfFVWbEg_PfUrLp9N6YPT81sZgTUAXLzsWU-t7UYrqj36dHhxskWnFMn62dv05UWu-7mueK8QL4CzYURPo5bXJ5aYp1ECqrWhoMlfO0Vw6S5yZRV24rJDjeaqLYTb6XOm_z4O3oao_nCrsMB2itB-8xJeqeHFLA_AhkJRw7ARqq2E2rBPlL3raBCyVaYmB8Pw8QKHa8VW32ROR3x_mB_HNPnk9WFkHemwuwiL2drFkWq1-0oW_QEzK4Tq8phaI89Ko-4V7OOhXPe46YsnD75WBg93mIVcKp5Ubc8VzgAjNhlL-4nklNpmBT7xm7ZHUmxaIJEZ5NBWY8WXBPsqEShAxAlSD-sYJMaAfNgSoHNX81E2nzqY_0oFHQ0-raMFP5uzVA9-3bvq_xGgsnJyVJs-HDLXg_6fRK6FdWcbETZsDVA",
            "hasHours": true,
            "weekdayDescriptions": [
              "Monday: Open 24 hours",
              "Tuesday: Open 24 hours",
              "Wednesday: Open 24 hours",
              "Thursday: Open 24 hours",
              "Friday: Open 24 hours",
              "Saturday: Open 24 hours",
              "Sunday: Open 24 hours"
            ],
            "location": {
              "lat": 35.6609856,
              "lng": 139.69871369999998
            },
            "travelToNext": "23 minute drive"
          },
          {
            "time": "afternoon",
            "type": "activity",
            "name": "Akihabara Electric Town",
            "categoryTag": "District · Shopping",
            "description": "Explore anime, manga, and electronics shops.",
            "startTime": "15:45",
            "durationMinutes": 90,
            "mealType": null,
            "address": "1 Chome-12 Sotokanda, Chiyoda City, Tokyo 101-0021, Japan",
            "rating": 4.5,
            "ratingCount": 8497,
            "photoUrl": "/api/place-photo?ref=places%2FChIJZzSYoB2MGGARfBcicn7sx28%2Fphotos%2FAaVGc3mE6jOUjf6h_fLKn3M5Lat19MsQ2othZ4Rj__j2v0c_pbY1R-oftNuIkgQCSv6iNFrxL7CFxPvuBkYyKNO-8dQTIeGp8uEhLwerqc1mKB4EY3LFVFBDDOpgMOCVhVH6hqwMgQTcnAXfQRA4Gj8UYvw8iCYjycGcXJ94Z5BMiNXoZha_2p5r3SYm-Rmjh-DdAn9hCh-1_WTegQ28vB0jPoSjIO1zxwSk05mXBJAA2gd6NNAod5_vjSZmmopXBIffK4Z7aaiLE3ZwSjJzc6IxybpbevOsd2DumrMSVUfVNhrFH__FeltaOGBvZO6S2Dt31V9ueoRDTuhMQhj_AF3_UUWzcF8gTeMNpLw_Z989I2goA0FtRmtJX4DW3x6jBBZo4kEm1p-NQxFU0jp_EDAXmb9T_AJ9D4rCLC3mY6x1aW_rLuWL",
            "hasHours": false,
            "weekdayDescriptions": null,
            "location": {
              "lat": 35.699717799999995,
              "lng": 139.7713799
            },
            "travelToNext": "25 minute walk"
          },
          {
            "time": "late afternoon",
            "type": "activity",
            "name": "Ueno Park",
            "categoryTag": "Park · Nature",
            "description": "Stroll through Tokyo's spacious central park.",
            "startTime": "17:30",
            "durationMinutes": 60,
            "mealType": null,
            "address": "4 Uenokoen, Taito City, Tokyo 110-0007, Japan",
            "rating": 4.4,
            "ratingCount": 34310,
            "photoUrl": "/api/place-photo?ref=places%2FChIJw2qQRZuOGGARWmROEiM2y7E%2Fphotos%2FAaVGc3llNHAsTzZRe_JuIsGj91LbHHHiDReYEHqSMbI8TRKTb46vwINuj772C4d4MLOaubptwv20iJatAmrc_jAprHQS9XvJGa6CEbu9FCAQqoXYia4tfV2Bs4CGOk5Q4FUCfH4rFZ2JF0rcjROa_mFqbBBf0BXCtCedHpqr1MW7Zns4amCx-RjObbULNuVIz23HNGz6mh7ZcFLBP7EGe-_n_HnZ8A8A2JpBcpuy2XESFgNSxcolufJFpGWafgSAxAiqpcyHAyIfT18PpW2I2IIuFTT6pd6gjsbkGhf0a65Xp5WmdG_VVa1mbYp9wGJ7lnGg-Do5tVYMJT5Ymil3JvD0KrdBCv174Xm8KviBD8ACdEywEPBP_AVbM1UJefuBJ-Lv_kIsMorq63Vm_WnvHyMIhcglk62wdsnU7AmbD7-ciucwqq5l",
            "hasHours": true,
            "weekdayDescriptions": [
              "Monday: 5:00 AM – 11:00 PM",
              "Tuesday: 5:00 AM – 11:00 PM",
              "Wednesday: 5:00 AM – 11:00 PM",
              "Thursday: 5:00 AM – 11:00 PM",
              "Friday: 5:00 AM – 11:00 PM",
              "Saturday: 5:00 AM – 11:00 PM",
              "Sunday: 5:00 AM – 11:00 PM"
            ],
            "location": {
              "lat": 35.7147557,
              "lng": 139.7734312
            },
            "travelToNext": "10 minute drive"
          },
          {
            "time": "dinner",
            "type": "meal",
            "name": "Sometarō Okonomiyaki restaurant",
            "categoryTag": "Restaurant · Casual",
            "description": "Cook your own savory Japanese pancakes.",
            "startTime": "19:30",
            "durationMinutes": 75,
            "mealType": "dinner",
            "address": "2-chōme-2-2 Nishiasakusa, Taito City, Tokyo 111-0035, Japan",
            "rating": 4.4,
            "ratingCount": 1675,
            "photoUrl": "/api/place-photo?ref=places%2FChIJR6VxAL-OGGARDytTRfiKddE%2Fphotos%2FAaVGc3norHAk40gQEuuR80OHsPrxCkvQYGc64d5XghDgzutJBlo0s02lCgUAXoFyVauUZmfPsbZEVsnVtqcTpv6CPebV0VUcIrcC3tOKRAzXiMgF_69GJIWSpFyrsXLuZtL1BvSIvOwWpGWNXoFQrnMRfEEXelRWzaAGRi3PHsUJ1Ri2GdOYfOidUso1neUZXM_KnVuMxnXEkLtZSF9g_C2iO8p36a80kpqPMX4rWAF9msdHTeoZ9PI92efxMQU5mimWS4wlQ4wud4x8cqqv4ylANQpKoS7zdxATXGnp5RyiQ13ED3RR7oTNOZQaMao_JG1tyTn3Rwy3VmsIj2Ok8fPGFujDdzcyKR2koA-XfUVAq9MmRgiqDiXHlJUSFF4NL904sNniNtlDQaeePja_c0zNMcAj1mMn49rJGueTgn33Heo3gXyx",
            "hasHours": true,
            "weekdayDescriptions": [
              "Monday: 12:00 – 2:30 PM, 5:30 – 8:30 PM",
              "Tuesday: Closed",
              "Wednesday: Closed",
              "Thursday: 12:00 – 2:30 PM, 5:30 – 8:30 PM",
              "Friday: 12:00 – 2:30 PM",
              "Saturday: 12:00 – 8:30 PM",
              "Sunday: 12:00 – 8:30 PM"
            ],
            "location": {
              "lat": 35.711909299999995,
              "lng": 139.7909269
            },
            "travelToNext": null
          }
        ],
        "stopCount": 7,
        "pacingLevel": 0.88
      },
    ],
    "pacingLabel": "Busy"
  },
  "slow": {
    "label": "Slow & Immersive",
    "tagline": "Relaxed deep-dive into fewer Tokyo neighborhoods",
    "divergenceLabel": "This itinerary focuses on depth over breadth, allowing more time to absorb each location and experience Tokyo's rhythms naturally.",
    "days": [
      {
        "day": 1,
        "theme": "Asakusa & Traditional Tokyo",
        "items": [
          {
            "time": "breakfast",
            "type": "meal",
            "name": "Asakusa Kagetsudō Melon Bread",
            "categoryTag": "Cafe · Traditional",
            "description": "Famous melon pan and coffee near Senso-ji.",
            "startTime": "09:00",
            "durationMinutes": 60,
            "mealType": "breakfast",
            "address": "2-chōme-7-13 Asakusa, Taito City, Tokyo 111-0032, Japan",
            "rating": 4.4,
            "ratingCount": 2829,
            "photoUrl": "/api/place-photo?ref=places%2FChIJSTVEQMCOGGARa74pG98OyD0%2Fphotos%2FAaVGc3nd4PT1sLXiz7bV6rQJgX4FUqDqvFYmzhkI-xWEFqaY0It1RM8qxahB2LhcfTP91x-tnvXNNwzl_xg-ucLXhQzj9YLiG1p5gaVwNpMGEnkgjJKpcF8E733UujIi4YEZJAspGz8_es7sYQaulonvxBPuxm-WwHjniZlFTNlwt_mE5RgHtnddEZIh7vxS_wPDLbIulXJd0I2o2oSIS-EKw2_vgTu-Dr6UfCWAKZyr5Un9epmLFFuQ02OdxoklSFMmtmJv95ryAhteg2tlqjpV8oMqPVjWbKCAR2on-82fUqBJZ0HvV41GX-Zf-8TjgJDpMOyKnRPPfT4UdZsVKSTBEqFiyFEISpLkwfORStkkMg7ZxLWp2cQuR5-JfkDD8dhma6JP1RrIz5lBaIcfvKzmb_ZATsZl6_U13ief1WD_0qisiRLc9rpCD7GjfbAMexVr",
            "hasHours": true,
            "weekdayDescriptions": [
              "Monday: 9:00 AM – 4:30 PM",
              "Tuesday: 9:00 AM – 4:30 PM",
              "Wednesday: 9:00 AM – 4:30 PM",
              "Thursday: 9:00 AM – 4:30 PM",
              "Friday: 9:00 AM – 4:30 PM",
              "Saturday: 9:00 AM – 5:00 PM",
              "Sunday: 9:00 AM – 5:00 PM"
            ],
            "location": {
              "lat": 35.7146332,
              "lng": 139.7951685
            },
            "travelToNext": "3 minute walk"
          },
          {
            "time": "morning",
            "type": "activity",
            "name": "Sensō-ji",
            "categoryTag": "Temple · Historic",
            "description": "Explore Tokyo's oldest temple and surrounding grounds leisurely.",
            "startTime": "10:30",
            "durationMinutes": 120,
            "mealType": null,
            "address": "2-chōme-3-1 Asakusa, Taito City, Tokyo 111-0032, Japan",
            "rating": 4.6,
            "ratingCount": 96645,
            "photoUrl": "/api/place-photo?ref=places%2FChIJ8T1GpMGOGGARDYGSgpooDWw%2Fphotos%2FAaVGc3nQ66g6Uqb12IrXfEcmyxActsUrgTzmnzr-EosdlAnFYpEu5SyoSv3T_p-L55JVb770iQva68kK8s7QgKkSv1bLA1wJl8glnt84Ce0gbBc_RZtigyD-3sThoa4ISNjE2Lp5JcfU0YNgq60slVxXWKfvhR0TVlg14kI3_gaEl0zRsHrxj3m9ZRyXdVZw-_J192oLdw6dYWCFu7s9vJp7VobU6hU6wepxBf4KglKtejizoeacKEMn48y1itE3VKYQF6f7kRg_LY7fXnLWFbLPYtFHHIaW8FKr1UquDbRAovjSHmhsrRBmfKGi0KRxvfp6Nk-VCKzewaj-MaTHhGgFQIZv-mNFwxok1vMW063ZRe-xy4U3FzKRrQpuJDFq_3ZUVw8nRVNUdrWrAO_0Cg_cE387D6QbiI6akMck9IpxVlqfcGDT",
            "hasHours": false,
            "weekdayDescriptions": null,
            "location": {
              "lat": 35.7147651,
              "lng": 139.7966553
            },
            "travelToNext": "8 minute walk"
          },
          {
            "time": "lunch",
            "type": "meal",
            "name": "Asakusa Imahan",
            "categoryTag": "Restaurant · Traditional",
            "description": "Premium sukiyaki and shabu-shabu establishment.",
            "startTime": "13:00",
            "durationMinutes": 90,
            "mealType": "lunch",
            "address": "3-chōme-1-12 Nishiasakusa, Taito City, Tokyo 111-0035, Japan",
            "rating": 4.5,
            "ratingCount": 2472,
            "photoUrl": "/api/place-photo?ref=places%2FChIJ99yU6b-OGGAR2NfOuMg0JUA%2Fphotos%2FAaVGc3lowOPjIVMVaCDQJPTeMMkZeyT-3bUkPXjhC58f77sq_3oVOclAW7cORqXYVI4qEtuzN0c4xd_nmjodY0hyssjoexBT5bvzBZ9OyS0Eivq2Z4Vj9dtN9JMXDjXU1gYXnZcWMElz70gZEDq8e-_sXEJxEEMzglgrJdzR6562MdXnXLMKqKwL2N-UA_O7yd7AnYBtlPWDyHY8hcOxKlHRMg1MRub5DeewTEUrJQ1db2xoL0Gm4fxEbXJZqLcQq6chC7MF04NDtbCaLTNLVXyRNs7DZD8pe0pal6KVTZUEkO0zlOjsPL9lSnEBX5yRBgEgRQzllgdq6pf1wQqRNbrkrKhHdNnzlAFGOrn-YsDfGHQRky1eOHE7N9ftiwE84Cc0H4YTqSZCy7NBNCdwMEcQRcrJ5ekH81VLOl4PTECMbweJ8Zu11O6Ez2R0ydP6McDR",
            "hasHours": true,
            "weekdayDescriptions": [
              "Monday: 11:30 AM – 7:30 PM",
              "Tuesday: 11:30 AM – 7:30 PM",
              "Wednesday: 11:30 AM – 7:30 PM",
              "Thursday: 11:30 AM – 7:30 PM",
              "Friday: 11:30 AM – 7:30 PM",
              "Saturday: 11:30 AM – 7:30 PM",
              "Sunday: 11:30 AM – 7:30 PM"
            ],
            "location": {
              "lat": 35.7139345,
              "lng": 139.7922291
            },
            "travelToNext": "13 minute walk"
          },
          {
            "time": "afternoon",
            "type": "activity",
            "name": "Asakusa",
            "categoryTag": "Cruise · Scenic",
            "description": "Relaxing boat ride with views of Tokyo landmarks.",
            "startTime": "15:00",
            "durationMinutes": 90,
            "mealType": null,
            "address": "1-chōme-2-7 Hanakawado, Taito City, Tokyo 111-0033, Japan",
            "rating": 4.2,
            "ratingCount": 855,
            "photoUrl": "/api/place-photo?ref=places%2FChIJ8RvoL8SOGGAR_jLysacG8sc%2Fphotos%2FAaVGc3nAWmrWiSppBlxB6LVR6Zjuuqb6ELRF-Ly059iVr4xqb_rNVu96mNl0I4U7F3clKGAKqMhSrgL7jL2OvwowRlzL03WiByljhO726cJr02f4EPmjITG4F2OuJ9oIJXyNC_AaoVt41_pbAtxW3tC81YayTLkenUg4UNfOr7MfUGEd6v0CRfpcf8VnrLhCh--Mzev0vuLWUlKSBW-RDRXt6fcx7wmxPRGH-ow5SBxzVh82ZQntWA3LDTnRmVgTJ65uNqTsAyPWGOUD-qGUlaAQoD-whwGgI2YDiN0ZwsLgNG5cBfpCbSFPd95qaebiaBw4VTpvZTW2zvSAO6j_LAGVNnBsCgqFlquEZcw3cG09uRKiR8pwy12MTDfrFSufHWpiMp5euUW1oykiP4NrBjxnG4tNfyyhAXPnm3v9ojcTzvSByzo",
            "hasHours": false,
            "weekdayDescriptions": null,
            "location": {
              "lat": 35.7107919,
              "lng": 139.79848619999999
            },
            "travelToNext": "8 minute walk"
          },
          {
            "time": "dinner",
            "type": "meal",
            "name": "Komakata Dojo",
            "categoryTag": "Restaurant · Historic",
            "description": "Traditional loach hotpot restaurant since 1801.",
            "startTime": "19:00",
            "durationMinutes": 90,
            "mealType": "dinner",
            "address": "1-chōme-7-12 Komagata, Taito City, Tokyo 111-0043, Japan",
            "rating": 4.3,
            "ratingCount": 3314,
            "photoUrl": "/api/place-photo?ref=places%2FChIJY57SxceOGGAR5p8zPgOh_p4%2Fphotos%2FAaVGc3mrCmySqZ_abfMcjBUuYE1l8kFDYPKncIsToeRjIG56bUMniF4gjrbYojIHXM5_V1T-vGvo4ZUnf2veTk_7D49EY5kcLSUR43QdsAbOtOgdq7ZGdigkY0T0eqQfv1Kz0U4DvCUzlesku3kZVqwh4BhW68WzRYbafpIg9O2NClLc-1AKaglVaWhwF8qvcHmUarNDSJcxBJkMXKIxJ_ikuaN4iSlkQtb-TENnMsQt__O03doHUa44ONrp7G_oLqRaXWncRJpiOQA09CvCysQSnv_qTVwwM6P083brf2SXJdsQfl7XbP9l4L1yJLs3mP8-C3o0guf1C8e7A1gjb_Ikq07Lke67hiA6QvdUVYXA6GU8wSlRLPjfd__K22ztqlHEavdjwywe4IxnVSPGwVT0uuypj0j-CSRFHaXckH9hWjoO9plxRPCpvR9htAbQi65i",
            "hasHours": true,
            "weekdayDescriptions": [
              "Monday: 11:00 AM – 8:30 PM",
              "Tuesday: 11:00 AM – 8:30 PM",
              "Wednesday: 11:00 AM – 8:30 PM",
              "Thursday: 11:00 AM – 8:30 PM",
              "Friday: 11:00 AM – 8:30 PM",
              "Saturday: 11:00 AM – 8:30 PM",
              "Sunday: 11:00 AM – 8:30 PM"
            ],
            "location": {
              "lat": 35.707524299999996,
              "lng": 139.7950215
            },
            "travelToNext": null
          }
        ],
        "stopCount": 5,
        "pacingLevel": 0.63
      },
      {
        "day": 2,
        "theme": "Imperial Palace & Ginza Elegance",
        "items": [
          {
            "time": "breakfast",
            "type": "meal",
            "name": "Cafe de L'ambre",
            "categoryTag": "Cafe · Vintage",
            "description": "Historic coffee house with aged beans.",
            "startTime": "09:00",
            "durationMinutes": 60,
            "mealType": "breakfast",
            "address": "8-chōme-10-15 Ginza, Chuo City, Tokyo 104-0061, Japan",
            "rating": 4.3,
            "ratingCount": 1895,
            "photoUrl": "/api/place-photo?ref=places%2FChIJZxiNeeiLGGARH3hUjIwOpSs%2Fphotos%2FAaVGc3kwIM61sTm7WTGrTc5BNJncnvDUcGk6bUliXi4iCYFs93YLLawF_LG1sIkqsBPGqfbVtuafGkKJykliXDODVtV8ssdG4K4pCUdwB_-yg4yI6kLU8rGC_gGvoElm7CUDZTms51T1lQOcfy8oLx6GZRg37eWzROyEzsqYgcolmtj5vxcpunjnd1TX8Qqtwub4HX_4CkeUoHqvk2zrlPImpwepm8p0b6TSDxxdbksLubawOXzpt5y34RrKjejeGCvT5lag82xUdSIR4uYmqjKp4qyC77Qo-f9xpMa1jJsN7NUl1fAGhrDVUcquB6BQ1Yb9xblAWnt20cKFdb1B4LX9cTez0zTDWn1zlB-rZk2Ss9sgnpYRAudt2-gehHmqHYywpGH8XorC8_BmtDXofTm9NkkiukV1JQa7BjtdYWDW-JyJzfON7go30XTTg8d7sw",
            "hasHours": true,
            "weekdayDescriptions": [
              "Monday: Closed",
              "Tuesday: 11:00 AM – 8:00 PM",
              "Wednesday: 11:00 AM – 8:00 PM",
              "Thursday: 11:00 AM – 8:00 PM",
              "Friday: 11:00 AM – 8:00 PM",
              "Saturday: 11:00 AM – 8:00 PM",
              "Sunday: 11:00 AM – 6:00 PM"
            ],
            "location": {
              "lat": 35.6679217,
              "lng": 139.7622983
            },
            "travelToNext": "10 minute drive"
          },
          {
            "time": "morning",
            "type": "activity",
            "name": "Imperial Palace East National Gardens",
            "categoryTag": "Garden · Historic",
            "description": "Peaceful exploration of royal gardens and history.",
            "startTime": "10:30",
            "durationMinutes": 120,
            "mealType": null,
            "address": "1-1 Chiyoda, Chiyoda City, Tokyo 100-8111, Japan",
            "rating": 4.4,
            "ratingCount": 10139,
            "photoUrl": "/api/place-photo?ref=places%2FChIJPfFaQhOMGGAR-QPbNQoAG6M%2Fphotos%2FAaVGc3kpF2cTff4r0XXYsTb-MfN9S8X30MZfQKKTic4VjU9SCyOzhhkDnZiZxOUfvzMDvF9uuA953Bxdv99M_D2msnhsiJHS4ynuENZyCc0t2tsxQ_5egyGoIC3osn7GQaHGwdqj6IQcHJe3Tds_JdZNfn8enxgVBoSQdPqL1-BjmPP7MvLpzM4CziLXmoHKrr1z42Lrn5zBjyfGuMJtCSQl6bfitocnU9MXfwkONKOtlVb_4ae5sVk35NnDKBluaEcNRYAb_-akx9aKkkrw3lGsLBQkVBKQLK08K7TDwgeP5hFdVRQmPHv5SDemv1PUR4oEgVEIB3z-3w6yeWTUeEtFCiF681HvNqSVer2NqLm4xr5eJfuSLi2iZO5Y26aj7F3qVBlxkacsN7BQqY9wuubYEprvaX9c5u9s9cHjm45t1Z9Arzs2",
            "hasHours": true,
            "weekdayDescriptions": [
              "Monday: Closed",
              "Tuesday: 9:00 AM – 6:00 PM",
              "Wednesday: 9:00 AM – 6:00 PM",
              "Thursday: 9:00 AM – 6:00 PM",
              "Friday: Closed",
              "Saturday: 9:00 AM – 6:00 PM",
              "Sunday: 9:00 AM – 6:00 PM"
            ],
            "location": {
              "lat": 35.6867824,
              "lng": 139.75714449999998
            },
            "travelToNext": "12 minute drive"
          },
          {
            "time": "lunch",
            "type": "meal",
            "name": "Ginza Kyūbey Ginza Honten",
            "categoryTag": "Restaurant · Sushi",
            "description": "Legendary sushi counter with Edo-style preparation.",
            "startTime": "13:00",
            "durationMinutes": 90,
            "mealType": "lunch",
            "address": "8-chōme-7-6 Ginza, Chuo City, Tokyo 104-0061, Japan",
            "rating": 4.4,
            "ratingCount": 2581,
            "photoUrl": "/api/place-photo?ref=places%2FChIJu3eG8uiLGGAR14kVvD_YrHI%2Fphotos%2FAaVGc3nUyHVB1UEqMwPYwKy7E44bJdOR1vf1K889c8RKACRawX3i9WxeK-JgWhM1xWEiUaPaCf0rPQco1F0OEYVg-wCH85YN-XgWUllmIXr0yhQz6GrV-z1mbj8nHmdc4YLrnZr8nwKke0UnllzF6b1jj652MNXQVgKaTUamJpBVkJiH8r5HAIMkEcOdCrR31Pt929mRAGMPr1_WsAHM8hff2UkG9aDeHTKGLtT7sDcbNEg8lWOHyiakee1A3NCpwbqKaEpU_8qGdM1OpAUdn34N5QaLX1yUE2HP5RB4n53s-WYnzT-iGapVor44OR0O6AJlhO4enG0OME-BEbV5kYCHpWaOhQkZfli9O6ZzmV9JA474nqzVZ_2vWLW1OVV-7u8QVvL9NV9YjwVZFpKpyvHvnH6XKFDTg95kouxo5yghh8VyoXuo1fXwsFc9H7lfZQ",
            "hasHours": true,
            "weekdayDescriptions": [
              "Monday: Closed",
              "Tuesday: 11:30 AM – 2:00 PM, 5:00 – 10:00 PM",
              "Wednesday: 11:30 AM – 2:00 PM, 5:00 – 10:00 PM",
              "Thursday: 11:30 AM – 2:00 PM, 5:00 – 10:00 PM",
              "Friday: 11:30 AM – 2:00 PM, 5:00 – 10:00 PM",
              "Saturday: 11:30 AM – 2:00 PM, 5:00 – 10:00 PM",
              "Sunday: Closed"
            ],
            "location": {
              "lat": 35.6684684,
              "lng": 139.7612701
            },
            "travelToNext": "9 minute walk"
          },
          {
            "time": "afternoon",
            "type": "activity",
            "name": "Mitsukoshi Ginza",
            "categoryTag": "District · Luxury",
            "description": "Stroll through upscale boutiques and department stores.",
            "startTime": "15:00",
            "durationMinutes": 120,
            "mealType": null,
            "address": "4-chōme-6-16 Ginza, Chuo City, Tokyo 104-8212, Japan",
            "rating": 4.1,
            "ratingCount": 21016,
            "photoUrl": "/api/place-photo?ref=places%2FChIJX9MhjuaLGGARvoMvduRK-5E%2Fphotos%2FAaVGc3lDNEI7DTW9A2Fj3WgHNBzhtenx-aBUoqNRcDrZkQypLLvSESoh5rtOWfMw7EzHRmtC89EEMoa0uVB5fMCtjCJmbA1L2_RV2sH2Rn7X-C7LcsWrDpU8t7hjGNTqr6e49PwnSfoIdA_bvUcWWzMeuaHrC9KyS7iu3LZRp93Gyts4lRTtkFiRi_ZMyxynEtN0j_jSmrxd2ARYwdVmSYM6a2_wX8SaRzG3UOo491Ig6td1v-T7oUiN0Ayj7kUAacbOzGOz0Q_pDKZoGHR1aO8Z7esU-qmhnf4n1G9vApnYbwEJ_W-nIanWKkobDivUcKdu8Die9ZrHMJEu66T3kJLNzA8C5QwOWGUeCrkymDwqJ_qCdhf9FLJZ3Yw1RaYTTIzWVfotwBwdCjAk3coqOMshbeumfRPOOVjzXXYcC2ZWUJZlD10q",
            "hasHours": true,
            "weekdayDescriptions": [
              "Monday: 10:00 AM – 8:00 PM",
              "Tuesday: 10:00 AM – 8:00 PM",
              "Wednesday: 10:00 AM – 8:00 PM",
              "Thursday: 10:00 AM – 8:00 PM",
              "Friday: 10:00 AM – 8:00 PM",
              "Saturday: 10:00 AM – 8:00 PM",
              "Sunday: 10:00 AM – 8:00 PM"
            ],
            "location": {
              "lat": 35.6712864,
              "lng": 139.7657382
            },
            "travelToNext": "6 minute walk"
          },
          {
            "time": "dinner",
            "type": "meal",
            "name": "Tempura Kondo",
            "categoryTag": "Restaurant · FineDining",
            "description": "Artistic tempura omakase experience.",
            "startTime": "19:30",
            "durationMinutes": 90,
            "mealType": "dinner",
            "address": "Japan, 〒104-0061 Tokyo, Chuo City, Ginza, 5-chōme−5−１３ Sakaguchi Bld., ９F",
            "rating": 4.4,
            "ratingCount": 946,
            "photoUrl": "/api/place-photo?ref=places%2FChIJX2Mb_eWLGGARvhx7F4hr3FA%2Fphotos%2FAaVGc3k-ks4CVR5jBjzJr8ANetuHvQbiIDPqHbU4prdd1Ql6HxqXhpo-b5FaLEwVVKqlhtiUE1ECVCatCdCaqHRadlxf4N23yE9EdPJ-Zlty33VmkNo34KgBu-IX6g__cNrEk6nZTB6Izehsh5LrSGIxgHtcgTnBJp78w7_356K-ASZXvWKOyH49YkWSRbhKyqG_iRbXslL59dNSjPP4PC6H6nNYMKPv82w6Z4mQyYYsqtXqrnfDYKEKRHy4xQEDd4m7ZCU-vBysppos3ovPkMgHFkbmkCB2ms08GpvPhRrAeZrCwgglylpRUOUeBpBdv9Kas7Fyb8kThar2MrPYdt6f95sBArq_MD_A3bz9uDmdvsW3HgQw1DQzDRXiMg8p__pmfjQHYxzgOfPreit3UkzJRrOCxA8Y46IBsKFVVyCDIO3Evw",
            "hasHours": true,
            "weekdayDescriptions": [
              "Monday: 12:00 – 3:00 PM, 5:00 – 8:00 PM",
              "Tuesday: 12:00 – 3:00 PM, 5:00 – 8:00 PM",
              "Wednesday: 12:00 – 3:00 PM, 5:00 – 8:00 PM",
              "Thursday: 12:00 – 3:00 PM, 5:00 – 8:00 PM",
              "Friday: 12:00 – 3:00 PM, 5:00 – 8:00 PM",
              "Saturday: 12:00 – 3:00 PM, 5:00 – 9:00 PM",
              "Sunday: Closed"
            ],
            "location": {
              "lat": 35.6711696,
              "lng": 139.7631786
            },
            "travelToNext": null
          }
        ],
        "stopCount": 5,
        "pacingLevel": 0.63
      },
    ],
    "pacingLabel": "Relaxed"
  }
};
