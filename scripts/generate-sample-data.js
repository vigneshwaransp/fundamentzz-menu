const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const sharp = require('sharp');

async function createSampleDishImage(name, colorBg, colorFg) {
  // Generate a clean 600x600 SVG representing a vibrant dish plate
  const svg = `
    <svg width="600" height="600" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="grad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="${colorBg}" />
          <stop offset="85%" stop-color="${colorBg}" />
          <stop offset="100%" stop-color="#0a1d13" />
        </radialGradient>
      </defs>
      <rect width="600" height="600" fill="#0e2a1c" />
      <circle cx="300" cy="300" r="260" fill="url(#grad)" stroke="#e8b13a" stroke-width="8" />
      <circle cx="300" cy="300" r="220" fill="none" stroke="rgba(244, 239, 226, 0.2)" stroke-width="3" stroke-dasharray="6,6" />
      <text x="50%" y="48%" font-family="sans-serif" font-weight="bold" font-size="34" fill="${colorFg}" text-anchor="middle" dominant-baseline="middle">
        ${name}
      </text>
      <text x="50%" y="58%" font-family="sans-serif" font-size="22" fill="#f4efe2" text-anchor="middle" dominant-baseline="middle">
        Fundamentzz Kitchen
      </text>
    </svg>
  `;

  return await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

async function main() {
  const samplesDir = path.join(__dirname, '..', 'samples');
  if (!fs.existsSync(samplesDir)) {
    fs.mkdirSync(samplesDir, { recursive: true });
  }

  // 1. Generate images for the Fundamentzz Zip
  console.log('Generating sample dish images...');
  const imgDosa = await createSampleDishImage('Ghee Roast Dosa', '#8b5a2b', '#f4efe2');
  const imgVada = await createSampleDishImage('Medu Vada', '#c68642', '#f4efe2');
  const imgCoffee = await createSampleDishImage('Filter Coffee', '#5c3317', '#f4efe2');
  const imgBiryani = await createSampleDishImage('Mushroom Biryani', '#b8621b', '#f4efe2');
  const imgMeals = await createSampleDishImage('Banana Leaf Meals', '#2d6a4f', '#f4efe2');
  const imgJigarthanda = await createSampleDishImage('Madurai Jigarthanda', '#a0522d', '#f4efe2');

  // 2. Fundamentzz archive JSON structure
  const fundamentzzArchiveJson = {
    format: "fundamentzz_menu_archive",
    categories: [
      { id: "c1", name: "Tiffin & Breakfast · காலை உணவு" },
      { id: "c2", name: "Chettinad Specialties · செட்டிநாடு விருந்து" },
      { id: "c3", name: "Beverages & Desserts · பானங்கள்" },
      { id: "c4", name: "Empty Category · காலியாக உள்ள பகுதி" } // Empty category test: should be skipped
    ],
    products: [
      {
        id: "p1",
        name: "Ghee Roast Dosa · நெய் ரோஸ்ட் தோசை",
        category_id: "c1",
        category_name: "Tiffin & Breakfast · காலை உணவு",
        selling_price: 110,
        unit: "portion", // "portion" should be hidden
        is_available: true,
        image_filename: "dosa.jpg",
        description: "Crispy golden fermented crepe roasted with fragrant cultured cow ghee, accompanied by 3 freshly ground chutneys and hot shallot sambar."
      },
      {
        id: "p2",
        name: "Medu Vada · மெது வடை",
        category_id: "c1",
        category_name: "Tiffin & Breakfast · காலை உணவு",
        selling_price: 45,
        unit: "2 pcs", // shown
        is_available: true,
        image_filename: "vada.jpg",
        description: "Crispy outer crust with fluffy urad dal interior, tempered with black pepper, curry leaves, ginger and green chillies."
      },
      {
        id: "p3",
        name: "Filter Coffee · கும்பகோணம் டிகிரி காபி",
        category_id: "c3",
        category_name: "Beverages & Desserts · பானங்கள்",
        selling_price: 35,
        unit: "1 cup", // shown
        is_available: true,
        image_filename: "coffee.jpg",
        description: "Freshly brewed chicory blend decoction frothed with pure farm milk in traditional brass davarah-tumbler."
      },
      {
        id: "p4",
        name: "Chettinad Mushroom Biryani · காளான் பிரியாணி",
        category_id: "c2",
        category_name: "Chettinad Specialties · செட்டிநாடு விருந்து",
        selling_price: 190,
        unit: "portion", // hidden
        is_available: true,
        image_filename: "biryani.jpg",
        description: "Aromatic Seeraga Samba rice slow cooked in stone-ground Chettinad spices, fresh button mushrooms, mint, and coconut milk."
      },
      {
        id: "p5",
        name: "Banana Leaf Full Meals · வாழை இலை சாப்பாடு",
        category_id: "c2",
        category_name: "Chettinad Specialties · செட்டிநாடு விருந்து",
        selling_price: 160,
        unit: "portion",
        is_available: false, // Sold out state test!
        image_filename: "meals.jpg",
        description: "Traditional feast with Ponni rice, paruppu, ghee, sambar, kara kuzhambu, rasam, kootu, poriyal, appalam and payasam."
      },
      {
        id: "p6",
        name: "Madurai Jigarthanda · மதுரை ஜிகர்தண்டா",
        category_id: "c3",
        category_name: "Beverages & Desserts · பானங்கள்",
        selling_price: 80,
        unit: "1 glass",
        is_available: true,
        image_filename: "jigarthanda.jpg",
        description: "Royal Madurai coolant with almond gum (badam pisin), nannari syrup, reduced milk basundi, and hand-churned ice cream."
      }
    ]
  };

  // 3. Create ZIP archive
  console.log('Packaging sample-fundamentzz-menu.zip...');
  const zip = new AdmZip();
  zip.addFile('menu.json', Buffer.from(JSON.stringify(fundamentzzArchiveJson, null, 2)));
  zip.addFile('images/dosa.jpg', imgDosa);
  zip.addFile('images/vada.jpg', imgVada);
  zip.addFile('images/coffee.jpg', imgCoffee);
  zip.addFile('images/biryani.jpg', imgBiryani);
  zip.addFile('images/meals.jpg', imgMeals);
  zip.addFile('images/jigarthanda.jpg', imgJigarthanda);

  const zipPath = path.join(samplesDir, 'sample-fundamentzz-menu.zip');
  zip.writeZip(zipPath);
  console.log(`Created: ${zipPath}`);

  // 4. Create sample CSV menu
  const csvContent = `category,name,price,description,unit,available,image
Breakfast,Idli Sambar · இட்லி சாம்பார்,40,"Steamed fluffy rice-lentil cakes with shallot sambar and coconut chutney",2 pcs,true,
Breakfast,Poori Masala · பூரி கிழங்கு,75,"Puffed whole wheat bread served with spiced potato onion masala",3 pcs,true,
Meals,Curd Rice · தயிர் சாதம்,65,"Tempered seasoned yogurt rice with mustard seeds, pomegranate and ginger",portion,true,
Desserts,Rava Kesari · ரவா கேசரி,55,"Semolina dessert infused with saffron, pure ghee, roasted cashews and raisins",portion,false,
`;
  const csvPath = path.join(samplesDir, 'sample-menu.csv');
  fs.writeFileSync(csvPath, csvContent, 'utf8');
  console.log(`Created: ${csvPath}`);

  console.log('Sample files generated successfully.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
