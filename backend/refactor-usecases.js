const fs = require('fs');
const path = require('path');

const useCasesDir = path.join(__dirname, 'src', 'application', 'useCases');
const files = fs.readdirSync(useCasesDir).filter(f => f.endsWith('.ts'));

for (const file of files) {
    const filePath = path.join(useCasesDir, file);
    let content = fs.readFileSync(filePath, 'utf8');

    if (!content.includes('tsyringe')) {
        content = content.replace(
            "import { IPsychotherapyRepository }",
            "import { injectable, inject } from 'tsyringe';\nimport { IPsychotherapyRepository }"
        );
        content = content.replace("export class", "@injectable()\nexport class");
        content = content.replace(
            "constructor(private readonly repository: IPsychotherapyRepository)",
            "constructor(@inject('IPsychotherapyRepository') private readonly repository: IPsychotherapyRepository)"
        );
        fs.writeFileSync(filePath, content);
        console.log(`Updated ${file}`);
    }
}
