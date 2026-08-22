import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Cookie, FileCheck2, ShieldCheck } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import './legal.css';

export type LegalDocument = 'privacy' | 'terms' | 'cookies' | 'program';
const effectiveDate = '22 de agosto de 2026';

const documents: Record<LegalDocument, { eyebrow: string; title: string; intro: string; sections: { title: string; body: React.ReactNode }[] }> = {
  privacy: {
    eyebrow: 'PRIVACIDADE E LGPD', title: 'Política de Privacidade',
    intro: 'Esta política explica como dados pessoais são utilizados na plataforma Fideliza Plus e nos programas de fidelidade das lojas participantes.',
    sections: [
      { title: '1. Quem trata os dados', body: <><p>A loja em cujo programa você se cadastrou decide as regras de fidelidade e, em regra, atua como controladora dos dados desse programa. A Fideliza Plus fornece a tecnologia e atua como operadora conforme as instruções da loja.</p><p>Para contas administrativas, segurança, faturamento e suporte da própria plataforma, a Fideliza Plus poderá atuar como controladora.</p></> },
      { title: '2. Dados que podemos tratar', body: <ul><li>Identificação e contato, como nome, CPF, telefone e e-mail;</li><li>dados da conta, autenticação, consentimentos e preferências;</li><li>compras identificadas, pontos, benefícios, resgates e cupons;</li><li>dados técnicos e de segurança, como IP, dispositivo, registros de acesso e eventos;</li><li>mensagens e solicitações enviadas ao suporte.</li></ul> },
      { title: '3. Finalidades e bases legais', body: <><p>Usamos os dados para criar e proteger a conta, identificar compras, calcular ou estornar pontos, disponibilizar benefícios, prestar suporte, prevenir fraudes, cumprir obrigações legais e manter a plataforma segura.</p><p>O tratamento pode se apoiar na execução de contrato ou procedimentos preliminares, cumprimento de obrigação legal, legítimo interesse avaliado de forma responsável e, quando necessário, consentimento. Comunicações promocionais opcionais dependem da preferência registrada e podem ser canceladas.</p></> },
      { title: '4. Compartilhamento e transferências', body: <><p>Os dados podem ser compartilhados com a loja participante e com fornecedores necessários de hospedagem, comunicação, ERP, pagamentos e segurança, sempre no limite da finalidade. Também poderão ser fornecidos a autoridades quando houver obrigação legal.</p><p>Se um fornecedor processar dados fora do Brasil, serão adotadas as salvaguardas aplicáveis à transferência internacional.</p></> },
      { title: '5. Retenção e segurança', body: <><p>Conservamos os dados pelo tempo necessário ao programa, ao contrato, à defesa de direitos e às obrigações legais. Encerrada a finalidade, os dados serão eliminados ou anonimizados, salvo quando a conservação for permitida.</p><p>Aplicamos controles de acesso, separação entre empresas, registros de auditoria, proteção de credenciais, backups e monitoramento. Nenhum ambiente é absolutamente invulnerável; incidentes relevantes serão tratados e comunicados conforme a legislação.</p></> },
      { title: '6. Seus direitos', body: <><p>Você pode solicitar confirmação e acesso, correção, informação sobre compartilhamento, portabilidade quando aplicável, anonimização, bloqueio ou eliminação, oposição, revogação de consentimento e revisão de decisões automatizadas.</p><p>Para exercer seus direitos, use a Central de Ajuda do portal ou escreva para <a href="mailto:contato@fidelizaplus.com.br">contato@fidelizaplus.com.br</a>. A solicitação poderá ser encaminhada à loja controladora. Poderemos pedir dados adicionais para confirmar sua identidade.</p></> },
      { title: '7. Crianças, decisões automatizadas e atualizações', body: <><p>O cadastro autônomo é destinado a maiores de 18 anos. Participação de menores deve ocorrer com assistência do responsável e conforme as regras da loja.</p><p>Recomendações e segmentações podem usar análises automatizadas, sem impedir o pedido de explicação ou revisão. Mudanças relevantes nesta política serão informadas por meio adequado.</p></> },
    ],
  },
  terms: {
    eyebrow: 'CONDIÇÕES DA PLATAFORMA', title: 'Termos de Uso',
    intro: 'Estes termos regulam o acesso administrativo e empresarial à plataforma Fideliza Plus.',
    sections: [
      { title: '1. Conta e acesso', body: <p>Cada pessoa deve usar uma conta própria, fornecer dados corretos, manter a senha protegida e respeitar o perfil de acesso concedido. A empresa responde pela administração de sua equipe e deve comunicar acessos indevidos.</p> },
      { title: '2. Uso permitido', body: <p>A plataforma deve ser usada para gestão legítima de clientes, vendas, fidelidade, campanhas e integrações. É proibido violar direitos, inserir dados obtidos ilegalmente, contornar controles, testar vulnerabilidades sem autorização ou usar a plataforma para fraude e mensagens abusivas.</p> },
      { title: '3. Assinaturas e cobrança', body: <p>Plano, limites, preço, vencimento e forma de pagamento constarão da contratação. Cobranças somente serão realizadas após adesão válida. Tributos, reajustes, cancelamento e inadimplência seguirão a proposta aceita e a legislação aplicável.</p> },
      { title: '4. Integrações e dados', body: <p>Integrações com ERP, pagamentos e comunicação dependem das credenciais e da disponibilidade dos respectivos fornecedores. A empresa deve ter base legal para os dados enviados e revisar os resultados de importações e automações.</p> },
      { title: '5. Disponibilidade, suporte e segurança', body: <p>Buscamos operação contínua, backups e correção de falhas, mas manutenções e indisponibilidades externas podem ocorrer. Incidentes serão priorizados conforme impacto e o nível de serviço contratado.</p> },
      { title: '6. Propriedade intelectual', body: <p>A tecnologia, marca, interfaces e documentação da Fideliza Plus permanecem protegidas. A empresa mantém os direitos sobre seus dados, sua marca e seus conteúdos, autorizando apenas o uso necessário à prestação do serviço.</p> },
      { title: '7. Suspensão, encerramento e responsabilidade', body: <p>Contas podem ser suspensas por risco de segurança, uso ilícito, inadimplência ou violação destes termos, com oportunidade de regularização quando cabível. No encerramento, a exportação e retenção seguirão o contrato e a Política de Privacidade. Nenhuma disposição elimina direitos indisponíveis previstos na legislação brasileira.</p> },
      { title: '8. Contato e legislação', body: <p>Dúvidas podem ser enviadas a <a href="mailto:contato@fidelizaplus.com.br">contato@fidelizaplus.com.br</a>. Aplicam-se as leis brasileiras, inclusive as regras de proteção de dados, internet e defesa do consumidor quando pertinentes.</p> },
    ],
  },
  program: {
    eyebrow: 'PORTAL DO CLIENTE', title: 'Termos do Programa de Fidelidade',
    intro: 'Estas regras gerais valem para a adesão de consumidores aos programas operados pelas lojas participantes.',
    sections: [
      { title: '1. Adesão', body: <p>A adesão é gratuita e vinculada à loja escolhida. É necessário informar dados verdadeiros, CPF válido, telefone e senha. Cada loja mantém seu programa separado; pontos de lojas diferentes não são somados.</p> },
      { title: '2. Acúmulo de pontos', body: <p>O acúmulo começa após a adesão. Compras posteriores identificadas pelo mesmo CPF podem gerar pontos conforme a regra vigente da loja. Compras sem CPF, anteriores ao cadastro ou fora das condições divulgadas podem não pontuar.</p> },
      { title: '3. Ajustes e estornos', body: <p>Cancelamentos, devoluções, chargebacks, erros ou fraude podem causar estorno automático dos pontos relacionados. Se o saldo ficar insuficiente, a loja poderá aguardar recomposição antes de permitir novo resgate.</p> },
      { title: '4. Validade e benefícios', body: <p>A loja define conversão, validade, estoque, elegibilidade e condições de cada recompensa. Pontos são promocionais, pessoais, não transferíveis, não têm valor monetário e não podem ser convertidos em dinheiro.</p> },
      { title: '5. Resgates e cupons', body: <p>Ao resgatar um benefício, os pontos correspondentes são descontados. Quando o cliente escolher usar o cupom, será gerado um código de uso único para informar à loja. Após a validação no pedido, o código fica indisponível.</p> },
      { title: '6. Comunicações e privacidade', body: <p>Mensagens operacionais sobre conta, pontos e segurança podem ser necessárias. Promoções opcionais respeitarão suas preferências. O tratamento de dados segue a <a href="/privacidade">Política de Privacidade</a>.</p> },
      { title: '7. Cancelamento e regras da loja', body: <p>O cliente pode solicitar encerramento pela Central de Ajuda. A loja pode publicar regras adicionais, desde que claras e compatíveis com a lei; em caso de divergência, prevalece a condição mais específica informada para o benefício, sem reduzir direitos legais.</p> },
    ],
  },
  cookies: {
    eyebrow: 'TRANSPARÊNCIA DIGITAL', title: 'Política de Cookies',
    intro: 'Usamos tecnologias estritamente necessárias para manter login, segurança e preferências da experiência.',
    sections: [
      { title: '1. O que são cookies', body: <p>Cookies são pequenos registros armazenados pelo navegador. O armazenamento local do dispositivo também pode guardar preferências da interface e informações da instalação web.</p> },
      { title: '2. Tecnologias utilizadas', body: <ul><li><b>Cookies de sessão:</b> mantêm o acesso de lojistas, administradores e clientes e ajudam a impedir uso indevido.</li><li><b>Preferências locais:</b> guardam, por exemplo, menu recolhido, loja acessada recentemente e confirmação deste aviso.</li><li><b>PWA:</b> arquivos técnicos podem ser mantidos em cache para melhorar carregamento e instalação do aplicativo web.</li></ul> },
      { title: '3. Cookies opcionais', body: <p>No momento, a experiência principal não instala cookies de publicidade nem de análise opcional. Se essas tecnologias forem adicionadas, será oferecida escolha prévia e um painel de preferências quando exigido.</p> },
      { title: '4. Como controlar', body: <p>Você pode apagar ou bloquear cookies nas configurações do navegador. O bloqueio dos cookies necessários pode impedir login, segurança de sessão e funcionamento de partes da plataforma.</p> },
      { title: '5. Contato', body: <p>Dúvidas sobre cookies e privacidade podem ser enviadas a <a href="mailto:contato@fidelizaplus.com.br">contato@fidelizaplus.com.br</a>.</p> },
    ],
  },
};

export function LegalFooter({ compact = false }: { compact?: boolean }) {
  return <footer className={`legal-footer ${compact ? 'compact' : ''}`}><a href="/privacidade">Privacidade</a><a href="/termos">Termos de uso</a><a href="/termos-programa">Termos do programa</a><a href="/cookies">Cookies</a></footer>;
}

export function LegalPage({ document }: { document: LegalDocument }) {
  const content = documents[document];
  return <main className="legal-page"><header><a href="/acesso"><ArrowLeft /> Voltar aos acessos</a><BrandLogo full /></header><article><div className="legal-title"><span><ShieldCheck /></span><div><small>{content.eyebrow}</small><h1>{content.title}</h1><p>{content.intro}</p><em>Versão 1.0 · Vigente desde {effectiveDate}</em></div></div>{content.sections.map(section => <section key={section.title}><h2>{section.title}</h2>{section.body}</section>)}<aside><FileCheck2 /><p>Este documento registra as regras operacionais atuais da Fideliza Plus. Ele poderá ser atualizado para refletir mudanças legais, contratuais ou do produto.</p></aside></article><LegalFooter /></main>;
}

export function CookieNotice() {
  const key = 'fideliza:cookie-notice-v1';
  const [visible, setVisible] = useState(false);
  useEffect(() => { setVisible(localStorage.getItem(key) !== 'acknowledged'); }, []);
  if (!visible) return null;
  return <aside className="cookie-notice" role="status"><Cookie /><p><b>Privacidade em primeiro lugar</b><span>Usamos apenas cookies necessários para login, segurança e preferências. <a href="/cookies">Saiba mais</a>.</span></p><button onClick={() => { localStorage.setItem(key, 'acknowledged'); setVisible(false); }}><Check /> Entendi</button></aside>;
}
