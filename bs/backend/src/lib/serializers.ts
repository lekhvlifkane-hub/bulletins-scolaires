import type { Role, School, User } from '@prisma/client';

export function publicUser(user: User) {
  return {
    id: user.id,
    schoolId: user.schoolId,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

export function publicSchool(school: School) {
  return {
    id: school.id,
    name: school.name,
    officialName: school.officialName,
    city: school.city,
    address: school.address,
    phone: school.phone,
    email: school.email,
    accreditationNumber: school.accreditationNumber,
    isActive: school.isActive,
    // Règles de calcul de l'établissement, modifiables depuis « Paramètres établissement ».
    // Les Decimal sont sérialisés en chaînes : aucune règle n'est convertie en nombre flottant.
    regleCalculMatiere: school.regleCalculMatiere,
    poidsDevoirs: school.poidsDevoirs,
    poidsCompositions: school.poidsCompositions,
    poidsAutres: school.poidsAutres,
    absencesComptentZero: school.absencesComptentZero,
    groupeSansNote: school.groupeSansNote,
    coefficientInvalide: school.coefficientInvalide,
    baremeParDefaut: school.baremeParDefaut,
    arrondiDecimales: school.arrondiDecimales,
    arrondiMode: school.arrondiMode,
    rangMode: school.rangMode,
    classerResultatsIncomplets: school.classerResultatsIncomplets,
    poidsSemestre1: school.poidsSemestre1,
    poidsSemestre2: school.poidsSemestre2,
    annuelSiSemestreManquant: school.annuelSiSemestreManquant,
    createdAt: school.createdAt,
  };
}

export function roleLabel(role: Role): string {
  switch (role) {
    case 'PLATFORM_ADMIN':
      return 'Administrateur plateforme';
    case 'SCHOOL_ADMIN':
      return "Administrateur d'établissement";
    case 'SURVEILLANT_GENERAL':
      return 'Surveillant général';
    case 'ASSISTANT':
      return 'Assistant';
    default:
      return role;
  }
}
